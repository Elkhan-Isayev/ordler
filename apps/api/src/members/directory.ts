import type { DirectoryView } from '@ordler/shared';
import { asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { departments, members, roles } from '../db/schema.js';

/**
 * Names every signed-in member may see, for pickers such as "add an approval" (SPEC §6.3).
 * Only ids and names: emails and roles of people stay in the admin panel.
 */
export async function loadDirectory(db: Db): Promise<DirectoryView> {
  const [people, depts, roleRows] = await Promise.all([
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.status, 'active'))
      .orderBy(asc(members.name)),
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(isNull(departments.archivedAt))
      .orderBy(asc(departments.name)),
    db
      .select({ id: roles.id, key: roles.systemKey, name: roles.name })
      .from(roles)
      .orderBy(asc(roles.name)),
  ]);
  return { members: people, departments: depts, roles: roleRows };
}
