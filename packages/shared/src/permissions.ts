/**
 * Permission catalog (SPEC §4.3). Every authorization check references these constants;
 * adding a permission means adding it here, updating system roles and their tests.
 */
export const PERMISSIONS = [
  // Installation settings such as the database connection; Owner only.
  'instance.manage',
  'org.manage',
  'org.audit.read',
  'auth.manage',
  'mail.manage',
  'member.invite',
  'member.deactivate',
  'member.role.assign',
  'department.create',
  'department.update',
  'department.archive',
  'team.create',
  'team.update',
  'team.archive',
  'role.create',
  'role.update',
  'role.delete',
  'workflow.manage',
  'request_type.manage',
  'approval_policy.manage',
  'sla_policy.manage',
  'portal.manage',
  'issue.read',
  'issue.create',
  'issue.update',
  'issue.delete',
  'issue.assign',
  'issue.move_team',
  'comment.create',
  'comment.delete_any',
  'cycle.manage',
  'project.manage',
  'initiative.manage',
  'view.create_shared',
  'request.create',
  'request.read_department',
  'request.triage',
  'request.comment_internal',
  'request.approve',
  'request.reassign',
  'api_key.manage',
  'webhook.manage',
  'integration.manage',
  'token.create_personal',
  'mcp.use',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const permissionSet: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}
