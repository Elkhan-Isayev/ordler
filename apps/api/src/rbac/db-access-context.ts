import { isPermission, type Permission, type RoleAssignment, type Scope } from '@ordler/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { roleAssignments, rolePermissions, teams } from '../db/schema.js';
import type { AccessContextSource, MemberAccess } from './permission.guard.js';

/** Loads a member's grants, their roles' permissions and the team → department map. */
export class DbAccessContext implements AccessContextSource {
  constructor(private readonly db: Db) {}

  async load(memberId: string): Promise<MemberAccess> {
    const rows = await this.db
      .select({
        roleId: roleAssignments.roleId,
        scopeType: roleAssignments.scopeType,
        scopeId: roleAssignments.scopeId,
      })
      .from(roleAssignments)
      .where(eq(roleAssignments.memberId, memberId));

    const assignments: RoleAssignment[] = rows.flatMap((row) => {
      const scope = toScope(row.scopeType, row.scopeId);
      return scope ? [{ roleId: row.roleId, scope }] : [];
    });

    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const permissionsByRole = new Map<string, Permission[]>();
    if (roleIds.length > 0) {
      const grants = await this.db
        .select()
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds));
      for (const grant of grants) {
        // Unknown strings (e.g. a permission removed in an upgrade) are ignored, never trusted.
        if (!isPermission(grant.permission)) continue;
        const list = permissionsByRole.get(grant.roleId) ?? [];
        list.push(grant.permission);
        permissionsByRole.set(grant.roleId, list);
      }
    }

    const needsDirectory = assignments.some((a) => a.scope.type === 'department');
    const departmentByTeam = new Map<string, string>();
    if (needsDirectory) {
      const rowsTeams = await this.db
        .select({ id: teams.id, departmentId: teams.departmentId })
        .from(teams);
      for (const team of rowsTeams) departmentByTeam.set(team.id, team.departmentId);
    }

    return {
      assignments,
      rolePermissions: (roleId) => permissionsByRole.get(roleId),
      directory: { departmentOfTeam: (teamId) => departmentByTeam.get(teamId) },
    };
  }
}

function toScope(
  type: 'organization' | 'department' | 'team',
  id: string | null,
): Scope | undefined {
  if (type === 'organization') return { type };
  return id ? { type, id } : undefined;
}
