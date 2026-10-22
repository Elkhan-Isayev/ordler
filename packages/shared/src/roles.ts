import { PERMISSIONS, type Permission } from './permissions.js';

export type ScopeType = 'organization' | 'department' | 'team';

export type SystemRoleKey =
  | 'owner'
  | 'org_admin'
  | 'department_admin'
  | 'department_supervisor'
  | 'team_lead'
  | 'member'
  | 'viewer'
  | 'guest';

export interface SystemRole {
  key: SystemRoleKey;
  /** Scope the role is normally granted at; assignments may still use a wider scope. */
  defaultScope: ScopeType;
  permissions: readonly Permission[];
}

const VIEWER: readonly Permission[] = ['issue.read', 'token.create_personal', 'mcp.use'];

const MEMBER: readonly Permission[] = [
  ...VIEWER,
  'issue.create',
  'issue.update',
  'issue.assign',
  'comment.create',
  'request.create',
  // Necessary but not sufficient: the active approval step must also resolve to the user.
  'request.approve',
];

const TEAM_LEAD: readonly Permission[] = [
  ...MEMBER,
  'team.update',
  'workflow.manage',
  'cycle.manage',
  'request.triage',
  'request.comment_internal',
  'issue.move_team',
  'issue.delete',
];

const DEPARTMENT_SUPERVISOR: readonly Permission[] = [...MEMBER, 'request.read_department'];

const DEPARTMENT_ADMIN: readonly Permission[] = [
  ...TEAM_LEAD,
  'request.read_department',
  'request.reassign',
  'member.invite',
  'team.create',
  'team.archive',
  'department.update',
  'request_type.manage',
  'approval_policy.manage',
  'sla_policy.manage',
  'portal.manage',
  'project.manage',
  'view.create_shared',
];

// Everything except installation settings, which stay with Owners (SPEC §4.2).
const ORG_ADMIN: readonly Permission[] = PERMISSIONS.filter((p) => p !== 'instance.manage');

/** System roles are seeded at setup and cannot be edited (SPEC §4.2). */
export const SYSTEM_ROLES: Readonly<Record<SystemRoleKey, SystemRole>> = {
  owner: { key: 'owner', defaultScope: 'organization', permissions: PERMISSIONS },
  org_admin: { key: 'org_admin', defaultScope: 'organization', permissions: ORG_ADMIN },
  department_admin: {
    key: 'department_admin',
    defaultScope: 'department',
    permissions: unique(DEPARTMENT_ADMIN),
  },
  department_supervisor: {
    key: 'department_supervisor',
    defaultScope: 'department',
    permissions: unique(DEPARTMENT_SUPERVISOR),
  },
  team_lead: { key: 'team_lead', defaultScope: 'team', permissions: unique(TEAM_LEAD) },
  member: { key: 'member', defaultScope: 'team', permissions: unique(MEMBER) },
  viewer: { key: 'viewer', defaultScope: 'team', permissions: unique(VIEWER) },
  guest: { key: 'guest', defaultScope: 'organization', permissions: ['request.create'] },
};

function unique(list: readonly Permission[]): readonly Permission[] {
  return [...new Set(list)];
}
