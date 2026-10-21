import {
  can,
  ORGANIZATION_SCOPE,
  type AdminRole,
  type Permission,
  type RoleInput,
} from '@ordler/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { roleAssignments, rolePermissions, roles } from '../db/schema.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';

/**
 * Custom roles (SPEC §4.1, Admin → Roles). System roles are seeded and read-only. Nobody can
 * put a permission into a role that they do not hold themselves organization-wide, so roles
 * never become a way to escalate.
 */
export class RolesService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessContextSource,
  ) {}

  async create(memberId: string, input: RoleInput & { permissions: string[] }): Promise<AdminRole> {
    await this.assertGrantable(memberId, input.permissions);
    await this.assertNameFree(input.name);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(roles).values({ name: input.name }).returning({ id: roles.id });
      if (input.permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(input.permissions.map((permission) => ({ roleId: row!.id, permission })));
      }
      return row!.id;
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'role.created',
      targetType: 'role',
      targetId: id,
      after: { name: input.name, permissions: input.permissions },
    });
    return this.get(id);
  }

  async update(
    memberId: string,
    id: string,
    input: RoleInput & { permissions: string[] },
  ): Promise<AdminRole> {
    const before = await this.custom(id);
    await this.assertGrantable(memberId, input.permissions);
    await this.assertNameFree(input.name, id);
    await this.db.transaction(async (tx) => {
      await tx.update(roles).set({ name: input.name }).where(eq(roles.id, id));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (input.permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(input.permissions.map((permission) => ({ roleId: id, permission })));
      }
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'role.updated',
      targetType: 'role',
      targetId: id,
      before: { name: before.name, permissions: before.permissions },
      after: { name: input.name, permissions: input.permissions },
    });
    return this.get(id);
  }

  /** Only unused roles go away, so no member silently loses access. */
  async remove(memberId: string, id: string): Promise<void> {
    const before = await this.custom(id);
    const [used] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(roleAssignments)
      .where(eq(roleAssignments.roleId, id));
    if ((used?.count ?? 0) > 0) throw new DomainError('role_in_use');
    await this.db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await tx.delete(roles).where(eq(roles.id, id));
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'role.deleted',
      targetType: 'role',
      targetId: id,
      before: { name: before.name, permissions: before.permissions },
    });
  }

  private async get(id: string): Promise<AdminRole> {
    const [role] = await this.db.select().from(roles).where(eq(roles.id, id));
    if (!role) throw new DomainError('not_found');
    const grants = await this.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, id));
    return {
      id: role.id,
      key: role.systemKey,
      name: role.name,
      permissions: grants.map((g) => g.permission).sort(),
    };
  }

  private async custom(id: string): Promise<AdminRole> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const role = await this.get(id);
    if (role.key) throw new DomainError('system_role');
    return role;
  }

  private async assertNameFree(name: string, except?: string): Promise<void> {
    const [taken] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(sql`lower(${roles.name}) = lower(${name})`, ...(except ? [ne(roles.id, except)] : [])),
      );
    if (taken) throw new DomainError('role_name_taken');
  }

  private async assertGrantable(memberId: string, permissions: string[]): Promise<void> {
    const access = await this.access.load(memberId);
    const missing = permissions.some(
      (permission) =>
        !can(
          access.assignments,
          access.rolePermissions,
          permission as Permission,
          ORGANIZATION_SCOPE,
          access.directory,
        ),
    );
    if (missing) throw new DomainError('forbidden');
  }
}
