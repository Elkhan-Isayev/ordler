import {
  ORGANIZATION_SCOPE,
  can,
  scopeCovers,
  type Permission,
  type WikiVisibility,
} from '@ordler/shared';
import type { AccessContextSource, MemberAccess } from '../rbac/permission.guard.js';

export interface WikiPermissions {
  read: boolean;
  edit: boolean;
  /** Visibility, deleting anything, Wiki.js import: department.update over the department. */
  manage: boolean;
}

/**
 * Who may do what in a department's wiki space (SPEC §5.6). A permission counts when it is
 * granted over the department, or over any of its teams: a team member belongs to the
 * department's knowledge. Organization-visible spaces are readable with `wiki.read` anywhere.
 */
export class WikiAccess {
  constructor(private readonly access: AccessContextSource) {}

  async forDepartment(
    memberId: string,
    department: { id: string; wikiVisibility: WikiVisibility },
  ): Promise<WikiPermissions> {
    return evaluate(await this.access.load(memberId), department);
  }

  /** One load for many spaces, for listings. */
  async forDepartments(
    memberId: string,
    departments: ReadonlyArray<{ id: string; wikiVisibility: WikiVisibility }>,
  ): Promise<Map<string, WikiPermissions>> {
    const loaded = await this.access.load(memberId);
    return new Map(departments.map((d) => [d.id, evaluate(loaded, d)]));
  }
}

export function evaluate(
  loaded: MemberAccess,
  department: { id: string; wikiVisibility: WikiVisibility },
): WikiPermissions {
  const inDepartment = (permission: Permission) =>
    loaded.assignments.some((assignment) => {
      const permissions = loaded.rolePermissions(assignment.roleId) ?? [];
      if (!permissions.includes(permission)) return false;
      const scope = assignment.scope;
      if (scopeCovers(scope, { type: 'department', id: department.id }, loaded.directory)) {
        return true;
      }
      return scope.type === 'team' && loaded.directory.departmentOfTeam(scope.id) === department.id;
    });
  const anywhere = (permission: Permission) =>
    loaded.assignments.some((a) => (loaded.rolePermissions(a.roleId) ?? []).includes(permission));
  const admin = can(
    loaded.assignments,
    loaded.rolePermissions,
    'org.manage',
    ORGANIZATION_SCOPE,
    loaded.directory,
  );

  const read =
    admin ||
    inDepartment('wiki.read') ||
    (department.wikiVisibility === 'organization' && anywhere('wiki.read'));
  const manage =
    read &&
    can(
      loaded.assignments,
      loaded.rolePermissions,
      'department.update',
      { type: 'department', id: department.id },
      loaded.directory,
    );
  return { read, edit: read && (inDepartment('wiki.edit') || manage), manage };
}
