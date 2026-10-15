import { describe, expect, it } from 'vitest';
import {
  can,
  effectivePermissions,
  ORGANIZATION_SCOPE,
  scopeCovers,
  type OrgDirectory,
  type RoleAssignment,
} from './rbac.js';
import { SYSTEM_ROLES, type SystemRoleKey } from './roles.js';

const directory: OrgDirectory = {
  departmentOfTeam: (teamId) => ({ help: 'it', infra: 'it', acc: 'finance' })[teamId],
};

const lookup = (roleId: string) => SYSTEM_ROLES[roleId as SystemRoleKey]?.permissions;

const IT = { type: 'department', id: 'it' } as const;
const FINANCE = { type: 'department', id: 'finance' } as const;
const HELP = { type: 'team', id: 'help' } as const;
const ACC = { type: 'team', id: 'acc' } as const;

describe('scopeCovers', () => {
  it('organization grants cover every target', () => {
    expect(scopeCovers(ORGANIZATION_SCOPE, ORGANIZATION_SCOPE, directory)).toBe(true);
    expect(scopeCovers(ORGANIZATION_SCOPE, IT, directory)).toBe(true);
    expect(scopeCovers(ORGANIZATION_SCOPE, HELP, directory)).toBe(true);
  });

  it('department grants cover the department and its teams only', () => {
    expect(scopeCovers(IT, IT, directory)).toBe(true);
    expect(scopeCovers(IT, HELP, directory)).toBe(true);
    expect(scopeCovers(IT, FINANCE, directory)).toBe(false);
    expect(scopeCovers(IT, ACC, directory)).toBe(false);
    expect(scopeCovers(IT, ORGANIZATION_SCOPE, directory)).toBe(false);
  });

  it('team grants cover only that team', () => {
    expect(scopeCovers(HELP, HELP, directory)).toBe(true);
    expect(scopeCovers(HELP, { type: 'team', id: 'infra' }, directory)).toBe(false);
    expect(scopeCovers(HELP, IT, directory)).toBe(false);
  });

  it('a team missing from the directory is not covered by any department', () => {
    expect(scopeCovers(IT, { type: 'team', id: 'unknown' }, directory)).toBe(false);
  });
});

describe('can', () => {
  it('lets a department admin create teams in their department', () => {
    const assignments: RoleAssignment[] = [{ roleId: 'department_admin', scope: IT }];
    expect(can(assignments, lookup, 'team.create', IT, directory)).toBe(true);
  });

  it('denies a department admin team creation in another department', () => {
    const assignments: RoleAssignment[] = [{ roleId: 'department_admin', scope: IT }];
    expect(can(assignments, lookup, 'team.create', FINANCE, directory)).toBe(false);
  });

  it('denies a member team creation (MVP acceptance criterion 1)', () => {
    const assignments: RoleAssignment[] = [{ roleId: 'member', scope: HELP }];
    expect(can(assignments, lookup, 'team.create', IT, directory)).toBe(false);
  });

  it('unions permissions across assignments', () => {
    const assignments: RoleAssignment[] = [
      { roleId: 'viewer', scope: HELP },
      { roleId: 'team_lead', scope: ACC },
    ];
    expect(can(assignments, lookup, 'request.triage', ACC, directory)).toBe(true);
    expect(can(assignments, lookup, 'request.triage', HELP, directory)).toBe(false);
    expect(can(assignments, lookup, 'issue.read', HELP, directory)).toBe(true);
  });

  it('ignores assignments to unknown roles', () => {
    const assignments: RoleAssignment[] = [{ roleId: 'deleted-role', scope: ORGANIZATION_SCOPE }];
    expect(effectivePermissions(assignments, lookup, HELP, directory).size).toBe(0);
  });

  it('grants nothing without assignments', () => {
    expect(can([], lookup, 'issue.read', HELP, directory)).toBe(false);
  });
});
