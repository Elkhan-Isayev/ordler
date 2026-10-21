import { can, effectivePermissions, ORGANIZATION_SCOPE, type MeResponse } from '@ordler/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { departments, teamMemberships, teams } from '../db/schema.js';
import { DbAccessContext } from '../rbac/db-access-context.js';
import { getInstance } from '../setup/setup.service.js';
import { findMemberById } from './members.js';

export type MeView = MeResponse;

/** Everything the app shell needs after sign-in: who I am and which teams I work in. */
export async function loadMe(db: Db, memberId: string): Promise<MeView | undefined> {
  const member = await findMemberById(db, memberId);
  const instance = await getInstance(db);
  if (!member || !instance) return undefined;

  const rows = await db
    .select({
      departmentId: departments.id,
      departmentName: departments.name,
      teamId: teams.id,
      teamKey: teams.key,
      teamName: teams.name,
    })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .innerJoin(departments, eq(departments.id, teams.departmentId))
    .where(
      and(
        eq(teamMemberships.memberId, memberId),
        isNull(teams.archivedAt),
        isNull(departments.archivedAt),
      ),
    )
    .orderBy(asc(departments.name), asc(teams.name));

  const access = await new DbAccessContext(db).load(memberId);
  const byDepartment = new Map<string, MeView['departments'][number]>();
  for (const row of rows) {
    const department = byDepartment.get(row.departmentId) ?? {
      id: row.departmentId,
      name: row.departmentName,
      teams: [],
    };
    const manage = can(
      access.assignments,
      access.rolePermissions,
      'team.update',
      { type: 'team', id: row.teamId },
      access.directory,
    );
    department.teams.push({
      id: row.teamId,
      key: row.teamKey,
      name: row.teamName,
      ...(manage ? { manage } : {}),
    });
    byDepartment.set(row.departmentId, department);
  }

  const organizationPermissions = [
    ...effectivePermissions(
      access.assignments,
      access.rolePermissions,
      ORGANIZATION_SCOPE,
      access.directory,
    ),
  ].sort();

  return {
    member: { id: member.id, name: member.name, email: member.email, locale: member.locale },
    workspace: { companyName: instance.companyName, defaultLocale: instance.defaultLocale },
    organizationPermissions,
    departments: [...byDepartment.values()],
  };
}
