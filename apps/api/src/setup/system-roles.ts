import { SYSTEM_ROLES, type SystemRoleKey } from '@ordler/shared';
import { and, eq, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rolePermissions, roles } from '../db/schema.js';

/** English fallback names; the UI shows translated names keyed by `system_key`. */
const ROLE_NAMES: Record<SystemRoleKey, string> = {
  owner: 'Owner',
  org_admin: 'Organization Admin',
  department_admin: 'Department Admin',
  department_supervisor: 'Department Supervisor',
  team_lead: 'Team Lead',
  member: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
};

/**
 * Makes system roles in the database match the code, idempotently. Runs on every start so an
 * upgrade that changes a role's permissions takes effect without a hand-written migration.
 */
export async function syncSystemRoles(db: Db): Promise<Record<SystemRoleKey, string>> {
  const ids = {} as Record<SystemRoleKey, string>;
  for (const role of Object.values(SYSTEM_ROLES)) {
    const [row] = await db
      .insert(roles)
      .values({ systemKey: role.key, name: ROLE_NAMES[role.key] })
      .onConflictDoUpdate({ target: roles.systemKey, set: { name: ROLE_NAMES[role.key] } })
      .returning({ id: roles.id });
    const roleId = row!.id;
    ids[role.key] = roleId;

    const wanted = [...role.permissions];
    await db
      .delete(rolePermissions)
      .where(
        and(eq(rolePermissions.roleId, roleId), notInArray(rolePermissions.permission, wanted)),
      );
    await db
      .insert(rolePermissions)
      .values(wanted.map((permission) => ({ roleId, permission })))
      .onConflictDoNothing();
  }
  return ids;
}

export async function systemRoleId(db: Db, key: SystemRoleKey): Promise<string | undefined> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.systemKey, key));
  return row?.id;
}

export async function roleExists(db: Db, roleId: string): Promise<boolean> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
  return row !== undefined;
}
