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
  /** Admin → Access tokens and MCP (SPEC §10.1). */
  mcpEnabled: boolean('mcp_enabled').notNull().default(true),
  tokenMaxExpiryDays: integer('token_max_expiry_days').notNull().default(365),
  tokenAllowNoExpiry: boolean('token_allow_no_expiry').notNull().default(false),
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
    /** Issues may have several assignees (ClickUp-style); one by default. */
    multipleAssignees: boolean('multiple_assignees').notNull().default(false),
    /** Cycles (SPEC §5.2): off until a team lead turns them on. */
    cyclesEnabled: boolean('cycles_enabled').notNull().default(false),
    cycleWeeks: integer('cycle_weeks').notNull().default(2),
    /** ISO weekday the cycle starts on: 1 = Monday … 7 = Sunday. */
    cycleStartDay: integer('cycle_start_day').notNull().default(1),
    cycleCooldownWeeks: integer('cycle_cooldown_weeks').notNull().default(0),
    /** How many future cycles are kept planned ahead. */
    cycleUpcoming: integer('cycle_upcoming').notNull().default(2),
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
    /** Created by someone outside the team: waits in Triage until accepted (SPEC §5.2). */
    inTriage: boolean('in_triage').notNull().default(false),
    /** The request this issue was spawned from or linked to (SPEC §6.2). */
    sourceRequestId: uuid('source_request_id'),
    /** Parent issue in the same team (SPEC §5.1 sub-issues); any depth. */
    parentId: uuid('parent_id'),
    cycleId: uuid('cycle_id'),
    projectId: uuid('project_id'),
    milestoneId: uuid('milestone_id'),
    /** Key in the tool it was imported from (ENG-123), kept as an alias (SPEC §10.2). */
    externalKey: text('external_key'),
    /** Position among the parent's sub-issues; ties fall back to creation order. */
    subOrder: doublePrecision('sub_order').notNull().default(0),
    /** Closed in triage as a duplicate of this issue (SPEC §5.1 relations). */
    duplicateOfId: uuid('duplicate_of_id'),
    createdBy: uuid('created_by').references(() => members.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('issues_team_number_uq').on(t.teamId, t.number),
    index('issues_team_status_idx').on(t.teamId, t.statusId),
    index('issues_assignee_idx').on(t.assigneeId),
    index('issues_parent_idx').on(t.parentId),
    index('issues_cycle_idx').on(t.cycleId),
    index('issues_project_idx').on(t.projectId),
    index('issues_external_key_idx').on(t.externalKey),
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
    /** Name of the personal token when an agent made the change (SPEC §10.1). */
    viaToken: text('via_token'),
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

/**
 * Comments on issues (later requests). `internal` matters for requests: requesters never see
 * internal comments (SPEC §6.2). Deleting keeps the row for history and clears nothing else.
 */
export const comments = pgTable(
  'comments',
  {
    id: id(),
    subjectType: text('subject_type', { enum: ['issue', 'request'] }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    authorId: uuid('author_id').references(() => members.id),
    body: text('body').notNull(),
    visibility: text('visibility', { enum: ['public', 'internal'] })
      .notNull()
      .default('public'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('comments_subject_idx').on(t.subjectType, t.subjectId, t.createdAt)],
);

/** Named counters for instance-wide numbers (REQ-57, REQ-G-12); bumped under a row lock. */
export const counters = pgTable('counters', {
  name: text('name').primaryKey(),
  value: integer('value').notNull().default(0),
});

/** What a department offers in its service portal (SPEC §6.1). */
export const requestTypes = pgTable(
  'request_types',
  {
    id: id(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category'),
    fields: jsonb('fields').notNull().default([]),
    targetTeamId: uuid('target_team_id')
      .notNull()
      .references(() => teams.id),
    /** Mandatory approval steps, in order: [{ selector, rule }]. */
    approvalSteps: jsonb('approval_steps').notNull().default([]),
    allowRequesterApprovals: boolean('allow_requester_approvals').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('request_types_department_idx').on(t.departmentId)],
);

/** One request to several departments; each department gets a child request (SPEC §6.4). */
export const requestGroups = pgTable('request_groups', {
  id: id(),
  number: integer('number').notNull().unique(),
  requesterId: uuid('requester_id').references(() => members.id),
  title: text('title').notNull(),
  createdAt: createdAt(),
});

export const requests = pgTable(
  'requests',
  {
    id: id(),
    number: integer('number').notNull().unique(),
    groupId: uuid('group_id').references(() => requestGroups.id),
    requestTypeId: uuid('request_type_id')
      .notNull()
      .references(() => requestTypes.id),
    requesterId: uuid('requester_id').references(() => members.id),
    requesterDepartmentId: uuid('requester_department_id').references(() => departments.id),
    targetDepartmentId: uuid('target_department_id')
      .notNull()
      .references(() => departments.id),
    targetTeamId: uuid('target_team_id')
      .notNull()
      .references(() => teams.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    formData: jsonb('form_data').notNull().default({}),
    status: text('status', {
      enum: [
        'pending_approval',
        'changes_requested',
        'rejected',
        'open',
        'in_progress',
        'waiting_for_requester',
        'resolved',
        'closed',
        'declined',
      ],
    }).notNull(),
    priority: text('priority', { enum: ['none', 'urgent', 'high', 'medium', 'low'] })
      .notNull()
      .default('none'),
    assigneeId: uuid('assignee_id').references(() => members.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('requests_requester_idx').on(t.requesterId),
    index('requests_target_team_idx').on(t.targetTeamId, t.status),
    index('requests_group_idx').on(t.groupId),
  ],
);

/**
 * Approval steps of a request, or of a request group (run before any child is released).
 * The resolved approver list is frozen at activation (SPEC §6.3).
 */
export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: id(),
    requestId: uuid('request_id').references(() => requests.id),
    groupId: uuid('group_id').references(() => requestGroups.id),
    position: integer('position').notNull(),
    origin: text('origin', { enum: ['mandatory', 'requester_added'] }).notNull(),
    selector: jsonb('selector').notNull(),
    rule: text('rule', { enum: ['any', 'all'] })
      .notNull()
      .default('any'),
    status: text('status', {
      enum: ['waiting', 'active', 'approved', 'rejected', 'changes_requested'],
    })
      .notNull()
      .default('waiting'),
    resolvedApproverIds: uuid('resolved_approver_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('approval_steps_request_idx').on(t.requestId),
    index('approval_steps_group_idx').on(t.groupId),
    check('approval_steps_owner', sql`(${t.requestId} is null) <> (${t.groupId} is null)`),
  ],
);

/** Every approval decision, append-only: never updated or deleted (SPEC §6.3). */
export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: id(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => approvalSteps.id),
    approverId: uuid('approver_id')
      .notNull()
      .references(() => members.id),
    decision: text('decision', { enum: ['approve', 'reject', 'request_changes'] }).notNull(),
    comment: text('comment'),
    /** SHA-256 of the request content the approver saw. */
    snapshotHash: text('snapshot_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('approval_decisions_step_idx').on(t.stepId)],
);

/** Append-only request history: submissions, approvals, status changes. */
export const requestEvents = pgTable(
  'request_events',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id),
    actorId: uuid('actor_id').references(() => members.id),
    kind: text('kind').notNull(),
    data: jsonb('data').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('request_events_request_idx').on(t.requestId, t.createdAt)],
);

/** A member's Inbox (SPEC §7): one row per recipient and event. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    kind: text('kind').notNull(),
    subjectType: text('subject_type', { enum: ['issue', 'request', 'request_group'] }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    actorId: uuid('actor_id').references(() => members.id),
    data: jsonb('data').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_member_idx').on(t.memberId, t.createdAt)],
);

/**
 * Slack channel subscriptions through incoming webhooks (SPEC §7.1, level 1). The webhook URL
 * is a secret: sealed with ENCRYPTION_KEY and never returned by the API.
 */
export const chatSubscriptions = pgTable(
  'chat_subscriptions',
  {
    id: id(),
    provider: text('provider', { enum: ['slack'] })
      .notNull()
      .default('slack'),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    name: text('name').notNull(),
    targetEncrypted: text('target_encrypted').notNull(),
    events: text('events').array().notNull(),
    createdBy: uuid('created_by').references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [index('chat_subscriptions_team_idx').on(t.teamId)],
);

/** Personal access tokens (SPEC §10.1): only a SHA-256 of the secret is stored. */
export const personalTokens = pgTable(
  'personal_tokens',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: text('last_used_ip'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('personal_tokens_hash_uq').on(t.tokenHash),
    index('personal_tokens_member_idx').on(t.memberId, t.createdAt),
  ],
);

/** Labels (SPEC §5.1): team labels, or organization labels when `team_id` is null. */
export const labels = pgTable(
  'labels',
  {
    id: id(),
    teamId: uuid('team_id').references(() => teams.id),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('labels_team_name_uq')
      .on(t.teamId, sql`lower(${t.name})`)
      .where(sql`${t.teamId} is not null`),
    uniqueIndex('labels_org_name_uq')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.teamId} is null`),
  ],
);

export const issueLabels = pgTable(
  'issue_labels',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.labelId] }),
    index('issue_labels_label_idx').on(t.labelId),
  ],
);

/**
 * Every assignee of an issue. `issues.assignee_id` stays the first one, so single-assignee
 * teams and older readers keep working (expand/contract).
 */
export const issueAssignees = pgTable(
  'issue_assignees',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.memberId] }),
    index('issue_assignees_member_idx').on(t.memberId),
  ],
);

/** A team's time-boxed iteration (SPEC §5.2). Dates are calendar days, both inclusive. */
export const cycles = pgTable(
  'cycles',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    number: integer('number').notNull(),
    name: text('name'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    /** Set once unfinished issues were rolled over to the next cycle. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cycles_team_number_uq').on(t.teamId, t.number),
    index('cycles_team_dates_idx').on(t.teamId, t.startsOn),
  ],
);

/** Projects (SPEC §5.2): work across one or more teams toward a target date. */
export const projects = pgTable('projects', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', {
    enum: ['planned', 'in_progress', 'paused', 'completed', 'canceled'],
  })
    .notNull()
    .default('planned'),
  leadId: uuid('lead_id').references(() => members.id),
  startDate: date('start_date'),
  targetDate: date('target_date'),
  createdBy: uuid('created_by').references(() => members.id),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const projectTeams = pgTable(
  'project_teams',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.teamId] }),
    index('project_teams_team_idx').on(t.teamId),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.memberId] })],
);

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    targetDate: date('target_date'),
    position: doublePrecision('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('project_milestones_project_idx').on(t.projectId)],
);

/** Status updates with health, newest first on the project page; never edited. */
export const projectUpdates = pgTable(
  'project_updates',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    authorId: uuid('author_id').references(() => members.id),
    health: text('health', { enum: ['on_track', 'at_risk', 'off_track'] }).notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('project_updates_project_idx').on(t.projectId, t.createdAt)],
);

/** Initiatives (SPEC §5.2): projects grouped under an organizational objective. */
export const initiatives = pgTable('initiatives', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['planned', 'active', 'completed'] })
    .notNull()
    .default('planned'),
  ownerId: uuid('owner_id').references(() => members.id),
  targetDate: date('target_date'),
  createdBy: uuid('created_by').references(() => members.id),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const initiativeProjects = pgTable(
  'initiative_projects',
  {
    initiativeId: uuid('initiative_id')
      .notNull()
      .references(() => initiatives.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.projectId] }),
    index('initiative_projects_project_idx').on(t.projectId),
  ],
);

/** One import from Linear or Jira (ADR 0010); the cursor makes it resumable. */
export const importRuns = pgTable('import_runs', {
  id: id(),
  source: text('source', { enum: ['linear', 'jira'] }).notNull(),
  /** `linear` or `jira:<base url>`: what external ids are unique within. */
  sourceKey: text('source_key').notNull(),
  baseUrl: text('base_url'),
  email: text('email'),
  /** Sealed with the instance key; erased once the run ends. */
  tokenEncrypted: text('token_encrypted'),
  account: jsonb('account').notNull().default({}),
  status: text('status', {
    enum: ['draft', 'running', 'paused', 'completed', 'failed', 'canceled'],
  })
    .notNull()
    .default('draft'),
  config: jsonb('config').notNull().default({}),
  cursor: jsonb('cursor').notNull().default({}),
  counts: jsonb('counts').notNull().default({}),
  report: jsonb('report').notNull().default([]),
  error: text('error'),
  /** A worker owns the run until then; a crashed worker's lease simply runs out. */
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => members.id),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const externalRefs = pgTable(
  'external_refs',
  {
    sourceKey: text('source_key').notNull(),
    kind: text('kind', { enum: ['issue', 'comment', 'attachment'] }).notNull(),
    externalId: text('external_id').notNull(),
    ordlerId: uuid('ordler_id').notNull(),
    /** The source's own updated time when last imported, to skip unchanged items. */
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => importRuns.id),
  },
  (t) => [primaryKey({ columns: [t.sourceKey, t.kind, t.externalId] })],
);

/** Outgoing webhooks (SPEC §10, ADR 0011): admin-configured endpoints with a signing secret. */
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: id(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  /** Sealed with the instance key; needed in plain text to sign, so not a hash. */
  secretEncrypted: text('secret_encrypted').notNull(),
  events: jsonb('events').notNull().default([]),
  scopeType: text('scope_type', { enum: ['organization', 'department', 'team'] }).notNull(),
  scopeId: uuid('scope_id'),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: uuid('created_by').references(() => members.id),
  createdAt: createdAt(),
});

/** One event for one endpoint, retried with backoff; also the delivery log. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    responseStatus: integer('response_status'),
    error: text('error'),
    createdAt: createdAt(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
  ],
);

/** Idempotency-Key replays for the public REST API (SPEC §10), kept for a day. */
export const apiIdempotencyKeys = pgTable(
  'api_idempotency_keys',
  {
    tokenId: uuid('token_id').notNull(),
    key: text('key').notNull(),
    /** Method, path and body hash: the same key with another request is refused. */
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    response: jsonb('response'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tokenId, t.key] }),
    index('api_idempotency_keys_created_idx').on(t.createdAt),
  ],
);
