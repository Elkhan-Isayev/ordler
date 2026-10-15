import { SYSTEM_ROLES } from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../auth/errors.js';
import { verifyPassword } from '../crypto/password.js';
import type { Db } from '../db/client.js';
import {
  auditLog,
  memberPasswords,
  members,
  roleAssignments,
  rolePermissions,
  roles,
} from '../db/schema.js';
import { FAST_ARGON2, OWNER, completeSetup } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { getInstance, SetupService } from './setup.service.js';
import { syncSystemRoles } from './system-roles.js';

let test: TestDatabase;
let db: Db;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
});
afterEach(() => test.close());

describe('SetupService', () => {
  it('requires setup on an empty database', async () => {
    expect(await new SetupService(db, 'https://x.test').isSetupRequired()).toBe(true);
  });

  it('creates the instance and the first Owner', async () => {
    const ownerId = await completeSetup(db);

    expect(await getInstance(db)).toEqual({
      companyName: 'Push30',
      baseUrl: 'https://ordler.test',
      defaultLocale: 'en',
    });
    const [owner] = await db.select().from(members).where(eq(members.id, ownerId));
    expect(owner).toMatchObject({ email: OWNER.email, status: 'active' });
    expect(owner!.emailVerifiedAt).not.toBeNull();

    const [password] = await db
      .select()
      .from(memberPasswords)
      .where(eq(memberPasswords.memberId, ownerId));
    expect(await verifyPassword(password!.hash, OWNER.password)).toBe(true);

    const [assignment] = await db
      .select({ key: roles.systemKey, scopeType: roleAssignments.scopeType })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(eq(roleAssignments.memberId, ownerId));
    expect(assignment).toEqual({ key: 'owner', scopeType: 'organization' });

    const audit = await db.select().from(auditLog);
    expect(audit.map((a) => a.action)).toContain('setup.completed');
    expect(JSON.stringify(audit)).not.toContain(OWNER.password);
  });

  it('only succeeds once', async () => {
    await completeSetup(db);
    await expect(completeSetup(db)).rejects.toMatchObject({ code: 'setup_completed' });
    expect(await new SetupService(db, 'https://x.test').isSetupRequired()).toBe(false);
  });

  it('lets exactly one of two concurrent submissions win', async () => {
    const service = new SetupService(db, 'https://x.test', FAST_ARGON2);
    const input = { companyName: 'A', defaultLocale: 'ru' as const, owner: OWNER };
    const results = await Promise.allSettled([
      service.completeSetup(input),
      service.completeSetup({ ...input, owner: { ...OWNER, email: 'other@push30.test' } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);
    expect(await db.select().from(members)).toHaveLength(1);
  });
});

describe('syncSystemRoles', () => {
  it('is idempotent and matches the code', async () => {
    await syncSystemRoles(db);
    const ids = await syncSystemRoles(db);
    expect(await db.select().from(roles)).toHaveLength(Object.keys(SYSTEM_ROLES).length);
    const guest = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, ids.guest));
    expect(guest.map((g) => g.permission)).toEqual(['request.create']);
  });

  it('removes permissions a role no longer has', async () => {
    const ids = await syncSystemRoles(db);
    await db.insert(rolePermissions).values({ roleId: ids.viewer, permission: 'team.create' });
    await syncSystemRoles(db);
    const viewer = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, ids.viewer));
    expect(viewer.map((v) => v.permission)).not.toContain('team.create');
  });
});
