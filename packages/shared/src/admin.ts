import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth.js';
import { PERMISSIONS } from './permissions.js';
import { teamKeySchema } from './schemas.js';

const nameSchema = z.string().trim().min(1).max(120);

export const updateDepartmentSchema = z
  .object({
    name: nameSchema,
    /** Department head; the `department_head` approver selector resolves to them. */
    headMemberId: z.uuid().nullable(),
  })
  .partial();

/** Team creation under `/departments/:departmentId/teams`; the department comes from the URL. */
export const createTeamBodySchema = z.object({
  name: nameSchema,
  key: teamKeySchema,
  isPrivate: z.boolean().default(false),
});

export const updateTeamSchema = z.object({ name: nameSchema, isPrivate: z.boolean() }).partial();

export const scopeInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('organization') }),
  z.object({ type: z.literal('department'), id: z.uuid() }),
  z.object({ type: z.literal('team'), id: z.uuid() }),
]);
export type ScopeInput = z.infer<typeof scopeInputSchema>;

export const assignRoleSchema = z.object({
  roleId: z.uuid(),
  scope: scopeInputSchema,
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const inviteMemberSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  /** Optional first grant, e.g. Member of a team. */
  role: assignRoleSchema.optional(),
  teamIds: z.array(z.uuid()).max(50).default([]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: nameSchema,
  password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const updateMemberStatusSchema = z.object({
  status: z.enum(['active', 'deactivated']),
});

/** Codes for admin operations, translated by the UI like auth error codes. */
export const ADMIN_ERROR_CODES = [
  'not_found',
  'team_key_taken',
  'department_name_taken',
  'email_taken',
  'last_owner',
  'cannot_change_self',
  'owner_only',
  'invite_invalid',
  'archived',
  'mail_managed_by_env',
  'database_managed_by_env',
  'system_role',
  'role_in_use',
  'role_name_taken',
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

/** Response item of GET /api/admin/departments. */
export interface AdminDepartment {
  id: string;
  name: string;
  headMemberId: string | null;
  archivedAt: string | null;
  teams: Array<{
    id: string;
    key: string;
    name: string;
    isPrivate: boolean;
    archivedAt: string | null;
    memberCount: number;
  }>;
}

/** Response item of GET /api/admin/members. */
export interface AdminMember {
  id: string;
  name: string;
  email: string;
  status: 'invited' | 'active' | 'deactivated';
  createdAt: string;
  roles: Array<{
    assignmentId: string;
    roleId: string;
    roleKey: string | null;
    roleName: string;
    scope: ScopeInput;
  }>;
  teamIds: string[];
}

/** Response item of GET /api/admin/roles. */
export interface AdminRole {
  id: string;
  key: string | null;
  name: string;
  permissions: string[];
}

/** Response of POST /api/admin/members (invite). */
export interface InviteResponse {
  member: AdminMember;
  /** Shown once to the admin to share; only its hash is stored. */
  inviteUrl: string;
  emailed: boolean;
}

/** Custom roles (SPEC §4.1): any catalog permission except installation settings. */
export const CUSTOM_ROLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'instance.manage');

export const roleInputSchema = z.object({
  name: nameSchema,
  permissions: z
    .array(z.enum(CUSTOM_ROLE_PERMISSIONS as unknown as [string, ...string[]]))
    .max(PERMISSIONS.length)
    .transform((list) => [...new Set(list)].sort()),
});
export type RoleInput = z.input<typeof roleInputSchema>;

/** Filters of GET /api/admin/audit; newest first, `before` is the last id of the previous page. */
export const auditQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  targetType: z.string().trim().max(60).optional(),
  actorId: z.uuid().optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;

/** One audit log row (SPEC §9); secrets were redacted when it was written. */
export interface AuditEntryView {
  id: string;
  actor: { type: 'member' | 'token' | 'system'; id: string | null; name: string | null };
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AuditPage {
  entries: AuditEntryView[];
  /** Pass as `before` to load older entries; null at the end. */
  next: string | null;
}
