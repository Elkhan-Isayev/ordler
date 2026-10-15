import { can } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import {
  departments,
  members,
  roleAssignments,
  rolePermissions,
  teamMemberships,
  teams,
} from '../db/schema.js';
import { loadMe } from '../members/me.js';
import { systemRoleId } from '../setup/system-roles.js';
import { completeSetup } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { DbAccessContext } from './db-access-context.js';

let test: TestDatabase;
let db: Db;
let ownerId: string;
let itId: string;
let financeId: string;
let helpId: string;
let accId: string;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
  const [it, finance] = await db
    .insert(departments)
    .values([{ name: 'IT' }, { name: 'Finance' }])
    .returning({ id: departments.id });
  itId = it!.id;
  financeId = finance!.id;
  const [help, acc] = await db
    .insert(teams)
    .values([
      { departmentId: itId, key: 'HELP', name: 'Helpdesk' },
      { departmentId: financeId, key: 'ACC', name: 'Accounting' },
    ])
    .returning({ id: teams.id });
  helpId = help!.id;
  accId = acc!.id;
});
afterEach(() => test.close());

async function memberWith(
  roleKey: Parameters<typeof systemRoleId>[1],
  scope: { type: 'organization' | 'department' | 'team'; id?: string },
) {
  const [member] = await db
    .insert(members)
    .values({ email: `${roleKey}@push30.test`, name: roleKey, status: 'active' })
    .returning({ id: members.id });
  await db.insert(roleAssignments).values({
    memberId: member!.id,
    roleId: (await systemRoleId(db, roleKey))!,
    scopeType: scope.type,
    scopeId: scope.id ?? null,
  });
  return member!.id;
}

describe('DbAccessContext', () => {
  it('gives the Owner every permission everywhere', async () => {
    const access = await new DbAccessContext(db).load(ownerId);
    const check = (scope: Parameters<typeof can>[3]) =>
      can(access.assignments, access.rolePermissions, 'team.create', scope, access.directory);
    expect(check({ type: 'organization' })).toBe(true);
    expect(check({ type: 'team', id: accId })).toBe(true);
  });

  it('applies department grants to that department’s teams only', async () => {
    const adminId = await memberWith('department_admin', { type: 'department', id: itId });
    const access = await new DbAccessContext(db).load(adminId);
    const check = (scope: Parameters<typeof can>[3]) =>
      can(access.assignments, access.rolePermissions, 'request.triage', scope, access.directory);
    expect(check({ type: 'team', id: helpId })).toBe(true);
    expect(check({ type: 'team', id: accId })).toBe(false);
    expect(check({ type: 'department', id: financeId })).toBe(false);
  });

  it('ignores permission strings outside the catalog', async () => {
    const viewerId = await memberWith('viewer', { type: 'team', id: helpId });
    await db
      .insert(rolePermissions)
      .values({ roleId: (await systemRoleId(db, 'viewer'))!, permission: 'everything.allowed' });
    const access = await new DbAccessContext(db).load(viewerId);
    expect(access.rolePermissions((await systemRoleId(db, 'viewer'))!)).not.toContain(
      'everything.allowed',
    );
  });

  it('grants nothing to a member without assignments', async () => {
    const [member] = await db
      .insert(members)
      .values({ email: 'plain@push30.test', name: 'Plain', status: 'active' })
      .returning({ id: members.id });
    const access = await new DbAccessContext(db).load(member!.id);
    expect(access.assignments).toEqual([]);
  });
});

describe('loadMe', () => {
  it('groups the member’s teams by department', async () => {
    await db.insert(teamMemberships).values([
      { teamId: helpId, memberId: ownerId },
      { teamId: accId, memberId: ownerId },
    ]);
    const me = await loadMe(db, ownerId);
    expect(me).toMatchObject({
      member: { id: ownerId, name: 'Owner' },
      workspace: { companyName: 'Push30', defaultLocale: 'en' },
      departments: [
        { name: 'Finance', teams: [{ key: 'ACC', name: 'Accounting' }] },
        { name: 'IT', teams: [{ key: 'HELP', name: 'Helpdesk' }] },
      ],
    });
  });

  it('returns nothing for unknown members', async () => {
    expect(await loadMe(db, '01a13d37-d040-7000-b257-95d0695e0576')).toBeUndefined();
  });
});
