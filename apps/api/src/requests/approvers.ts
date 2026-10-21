import type { ApproverSelector, SelectorNames } from '@ordler/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { departments, members, roleAssignments, roles } from '../db/schema.js';

export interface ResolveContext {
  requesterId: string;
  requesterDepartmentId: string | null;
  /** The department that receives the request; used for fallbacks. */
  targetDepartmentId: string;
}

/** Members holding a role at exactly one department, active only. */
async function roleHolders(db: Db, roleId: string, departmentId: string): Promise<string[]> {
  const rows = await db
    .select({ memberId: roleAssignments.memberId })
    .from(roleAssignments)
    .innerJoin(members, eq(members.id, roleAssignments.memberId))
    .where(
      and(
        eq(roleAssignments.roleId, roleId),
        eq(roleAssignments.scopeType, 'department'),
        eq(roleAssignments.scopeId, departmentId),
        eq(members.status, 'active'),
      ),
    );
  return [...new Set(rows.map((r) => r.memberId))];
}

async function systemRoleId(db: Db, key: string): Promise<string | undefined> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.systemKey, key));
  return row?.id;
}

async function activeOnly(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, ids), eq(members.status, 'active')));
  return rows.map((r) => r.id);
}

/** The department whose admins stand in when a selector finds nobody else. */
function fallbackDepartment(selector: ApproverSelector, ctx: ResolveContext): string {
  switch (selector.type) {
    case 'role':
    case 'department_head':
      return selector.departmentId;
    case 'requester_department_supervisor':
      return ctx.requesterDepartmentId ?? ctx.targetDepartmentId;
    case 'user':
      return ctx.targetDepartmentId;
  }
}

/**
 * Resolves who may decide a step at the moment it becomes active (SPEC §6.3). The requester
 * is never an approver of their own request (segregation of duties): if only they match, the
 * approving department's admins decide, and failing that the organization's Owners.
 */
export async function resolveApprovers(
  db: Db,
  selector: ApproverSelector,
  ctx: ResolveContext,
): Promise<string[]> {
  let ids: string[] = [];
  switch (selector.type) {
    case 'user':
      ids = await activeOnly(db, [selector.memberId]);
      break;
    case 'role':
      ids = await roleHolders(db, selector.roleId, selector.departmentId);
      break;
    case 'department_head': {
      const [dept] = await db
        .select({ head: departments.headMemberId })
        .from(departments)
        .where(eq(departments.id, selector.departmentId));
      ids = dept?.head ? await activeOnly(db, [dept.head]) : [];
      break;
    }
    case 'requester_department_supervisor': {
      const supervisor = await systemRoleId(db, 'department_supervisor');
      ids =
        supervisor && ctx.requesterDepartmentId
          ? await roleHolders(db, supervisor, ctx.requesterDepartmentId)
          : [];
      break;
    }
  }

  const withoutRequester = ids.filter((id) => id !== ctx.requesterId);
  if (withoutRequester.length > 0) return withoutRequester;

  const admin = await systemRoleId(db, 'department_admin');
  const admins = admin
    ? (await roleHolders(db, admin, fallbackDepartment(selector, ctx))).filter(
        (id) => id !== ctx.requesterId,
      )
    : [];
  if (admins.length > 0) return admins;

  const owner = await systemRoleId(db, 'owner');
  if (!owner) return [];
  const owners = await db
    .select({ memberId: roleAssignments.memberId })
    .from(roleAssignments)
    .innerJoin(members, eq(members.id, roleAssignments.memberId))
    .where(and(eq(roleAssignments.roleId, owner), eq(members.status, 'active')));
  return [...new Set(owners.map((o) => o.memberId))].filter((id) => id !== ctx.requesterId);
}

/** Names for showing a selector; the UI builds the translated label from them. */
export async function selectorNames(db: Db, selector: ApproverSelector): Promise<SelectorNames> {
  const department = async (id: string) =>
    (await db.select({ name: departments.name }).from(departments).where(eq(departments.id, id)))[0]
      ?.name;
  switch (selector.type) {
    case 'user': {
      const [member] = await db
        .select({ name: members.name })
        .from(members)
        .where(eq(members.id, selector.memberId));
      return member ? { member: member.name } : {};
    }
    case 'role': {
      const [role] = await db
        .select({ name: roles.name, key: roles.systemKey })
        .from(roles)
        .where(eq(roles.id, selector.roleId));
      const names: SelectorNames = {};
      if (role) names.role = role.key ?? role.name;
      const dept = await department(selector.departmentId);
      if (dept) names.department = dept;
      return names;
    }
    case 'department_head': {
      const dept = await department(selector.departmentId);
      return dept ? { department: dept } : {};
    }
    case 'requester_department_supervisor':
      return {};
  }
}
