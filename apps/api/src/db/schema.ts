import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Tables are unqualified: the connection search_path selects the Ordler schema (DB_SCHEMA).
// Primary keys use PostgreSQL 18 uuidv7(), which is time-ordered and index-friendly.
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const instanceSettings = pgTable('instance_settings', {
  id: id(),
  companyName: text('company_name').notNull(),
  baseUrl: text('base_url').notNull(),
  defaultLocale: text('default_locale').notNull().default('en'),
  branding: jsonb('branding').notNull().default({}),
  setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
});

export const departments = pgTable(
  'departments',
  {
    id: id(),
    name: text('name').notNull(),
    headMemberId: uuid('head_member_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('departments_name_active_uq')
      .on(t.name)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export const members = pgTable(
  'members',
  {
    id: id(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    name: text('name').notNull(),
    locale: text('locale'),
    timezone: text('timezone'),
    homeDepartmentId: uuid('home_department_id').references(() => departments.id),
    managerId: uuid('manager_id'),
    status: text('status', { enum: ['invited', 'active', 'deactivated'] })
      .notNull()
      .default('invited'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('members_email_uq').on(sql`lower(${t.email})`)],
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isPrivate: boolean('is_private').notNull().default(false),
    /** Last issue number handed out; incremented under a row lock so numbers never repeat. */
    issueCounter: integer('issue_counter').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('teams_key_uq').on(t.key),
    index('teams_department_idx').on(t.departmentId),
    check('teams_key_format', sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
  ],
);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.memberId] })],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    /** Set for seeded system roles (e.g. `team_lead`); null for custom roles. */
    systemKey: text('system_key'),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('roles_system_key_uq').on(t.systemKey)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    scopeType: text('scope_type', { enum: ['organization', 'department', 'team'] }).notNull(),
    scopeId: uuid('scope_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('role_assignments_member_idx').on(t.memberId),
    check(
      'role_assignments_scope_id',
      sql`(${t.scopeType} = 'organization') = (${t.scopeId} is null)`,
    ),
  ],
);

/** Append-only (SPEC §9); the application never updates or deletes rows here. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorType: text('actor_type', { enum: ['member', 'token', 'system'] }).notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);

export const memberPasswords = pgTable('member_passwords', {
  memberId: uuid('member_id')
    .primaryKey()
    .references(() => members.id, { onDelete: 'cascade' }),
  hash: text('hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per strategy kind; secrets are sealed with ENCRYPTION_KEY (SPEC §8.1). */
export const authStrategies = pgTable(
  'auth_strategies',
  {
    id: id(),
    kind: text('kind', { enum: ['local', 'email_otp', 'google'] }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    position: integer('position').notNull().default(0),
    displayName: text('display_name'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    secretsEncrypted: text('secrets_encrypted'),
    allowSelfRegistration: boolean('allow_self_registration').notNull().default(false),
    allowedDomains: text('allowed_domains')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    defaultRoleId: uuid('default_role_id').references(() => roles.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_strategies_kind_uq').on(t.kind)],
);

/** External identities (Google subject, later OIDC/SAML) linked to a member. */
export const memberIdentities = pgTable(
  'member_identities',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    strategyKind: text('strategy_kind').notNull(),
    providerSubject: text('provider_subject').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('member_identities_subject_uq').on(t.strategyKind, t.providerSubject)],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: id(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_challenges_email_idx').on(t.email, t.createdAt)],
);

/** Opaque session tokens; only the SHA-256 of the cookie value is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    strategyKind: text('strategy_kind').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_member_idx').on(t.memberId),
  ],
);

/** Single row: the last result of the GitHub release check (SPEC §16.5). */
export const updateStatus = pgTable('update_status', {
  id: integer('id').primaryKey().default(1),
  latestVersion: text('latest_version'),
  releaseName: text('release_name'),
  releaseUrl: text('release_url'),
  releaseNotes: text('release_notes'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  etag: text('etag'),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  lastError: text('last_error'),
});

/** One-time invitation links; only the SHA-256 of the token is stored (SPEC §8). */
export const memberInvites = pgTable(
  'member_invites',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('member_invites_token_hash_uq').on(t.tokenHash)],
);

/**
 * SMTP settings entered in Admin → Mail server (SPEC §8.2); a single row. The password is
 * sealed with ENCRYPTION_KEY. SMTP_* environment variables take precedence over this row.
 */
export const mailSettings = pgTable('mail_settings', {
  id: integer('id').primaryKey().default(1),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  security: text('security', { enum: ['none', 'starttls', 'tls'] }).notNull(),
  verifyTls: boolean('verify_tls').notNull().default(true),
  username: text('username'),
  passwordEncrypted: text('password_encrypted'),
  fromName: text('from_name'),
  fromEmail: text('from_email').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => members.id),
});

/** Status sets owned by a team (later also by request types), SPEC §5.2. */
export const workflows = pgTable(
  'workflows',
  {
    id: id(),
    ownerType: text('owner_type', { enum: ['team'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workflows_owner_uq').on(t.ownerType, t.ownerId)],
);

export const workflowStatuses = pgTable(
  'workflow_statuses',
  {
    id: id(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    /** Stable key of a default status, used for translation; null for custom statuses. */
    key: text('key'),
    name: text('name').notNull(),
    category: text('category', {
      enum: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }).notNull(),
    position: integer('position').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('workflow_statuses_workflow_idx').on(t.workflowId)],
);

export const issues = pgTable(
  'issues',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    statusId: uuid('status_id')
      .notNull()
      .references(() => workflowStatuses.id),
    priority: text('priority', { enum: ['none', 'urgent', 'high', 'medium', 'low'] })
      .notNull()
      .default('none'),
    assigneeId: uuid('assignee_id').references(() => members.id),
    dueDate: date('due_date'),
    /** Position inside a board column; smaller comes first. */
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => members.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('issues_team_number_uq').on(t.teamId, t.number),
    index('issues_team_status_idx').on(t.teamId, t.statusId),
    index('issues_assignee_idx').on(t.assigneeId),
  ],
);

/** Append-only issue history (SPEC §5.1 Activity); never updated or deleted. */
export const issueEvents = pgTable(
  'issue_events',
  {
    id: id(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id),
    actorId: uuid('actor_id').references(() => members.id),
    kind: text('kind', { enum: ['created', 'updated'] }).notNull(),
    changes: jsonb('changes').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('issue_events_issue_idx').on(t.issueId, t.createdAt)],
);

/** Raw bytes; node-postgres and PGlite both hand them over as Buffer/Uint8Array. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

/**
 * Files and images attached to issues (later comments and requests). Stored in PostgreSQL so
 * a restarted container loses nothing and one database backup covers everything (ADR 0008).
 */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    uploadedBy: uuid('uploaded_by').references(() => members.id),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_team_idx').on(t.teamId)],
);

/** Content kept apart from metadata, so listing attachments never reads the bytes. */
export const attachmentContents = pgTable('attachment_contents', {
  attachmentId: uuid('attachment_id')
    .primaryKey()
    .references(() => attachments.id),
  data: bytea('data').notNull(),
});
