import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth.js';
import { teamKeySchema } from './schemas.js';

const nameSchema = z.string().trim().min(1).max(120);

export const updateDepartmentSchema = z.object({ name: nameSchema }).partial();

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
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

/** Response item of GET /api/admin/departments. */
export interface AdminDepartment {
  id: string;
  name: string;
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
