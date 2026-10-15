import type { Permission } from './permissions.js';

/** Where a role is granted, or what a permission check targets (SPEC §4.1). */
export type Scope =
  { type: 'organization' } | { type: 'department'; id: string } | { type: 'team'; id: string };

export interface RoleAssignment {
  roleId: string;
  scope: Scope;
}

/** Resolves the organization tree; the only structural fact RBAC needs is team → department. */
export interface OrgDirectory {
  departmentOfTeam(teamId: string): string | undefined;
}

export type RolePermissionLookup = (roleId: string) => readonly Permission[] | undefined;

export const ORGANIZATION_SCOPE: Scope = { type: 'organization' };

/**
 * A grant applies to its own scope and everything below it:
 * organization > department > team.
 */
export function scopeCovers(grant: Scope, target: Scope, directory: OrgDirectory): boolean {
  switch (grant.type) {
    case 'organization':
      return true;
    case 'department':
      if (target.type === 'department') return target.id === grant.id;
      if (target.type === 'team') return directory.departmentOfTeam(target.id) === grant.id;
      return false;
    case 'team':
      return target.type === 'team' && target.id === grant.id;
  }
}

/** Union of permissions from every assignment whose scope covers the target. No explicit deny in v1. */
export function effectivePermissions(
  assignments: readonly RoleAssignment[],
  rolePermissions: RolePermissionLookup,
  target: Scope,
  directory: OrgDirectory,
): Set<Permission> {
  const result = new Set<Permission>();
  for (const assignment of assignments) {
    if (!scopeCovers(assignment.scope, target, directory)) continue;
    for (const permission of rolePermissions(assignment.roleId) ?? []) {
      result.add(permission);
    }
  }
  return result;
}

export function can(
  assignments: readonly RoleAssignment[],
  rolePermissions: RolePermissionLookup,
  permission: Permission,
  target: Scope,
  directory: OrgDirectory,
): boolean {
  return effectivePermissions(assignments, rolePermissions, target, directory).has(permission);
}
