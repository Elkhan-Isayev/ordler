import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
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
