import type { AdminMember, AdminRole, AuditPage, InviteResponse } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function invite(name: string, roleId?: string) {
  const created = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name}@push30.test`,
      name,
      ...(roleId ? { role: { roleId, scope: { type: 'organization' } } } : {}),
      teamIds: [],
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: created.inviteUrl.split('/invite/')[1]!,
    name,
    password: 'person-password-1',
  });
  return {
    cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE),
    id: created.member.id,
  };
}

const createRole = (cookie: string, name: string, permissions: string[]) =>
  call('POST', '/api/admin/roles', cookie, { name, permissions });

beforeEach(async () => {
  t = await createTestApp();
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
});
afterEach(() => t.close());

describe('custom roles', () => {
  it('creates a role that grants exactly its permissions', async () => {
    const created = await createRole(owner, 'Auditor', ['org.audit.read', 'org.audit.read']);
    expect(created.statusCode).toBe(201);
    const auditor = created.json<AdminRole>();
    expect(auditor).toMatchObject({ key: null, name: 'Auditor', permissions: ['org.audit.read'] });

    const person = await invite('aysel', auditor.id);
    expect((await call('GET', '/api/admin/audit', person.cookie)).statusCode).toBe(200);
    expect((await call('GET', '/api/admin/members', person.cookie)).statusCode).toBe(403);

    const plain = await invite('rauf');
    expect((await call('GET', '/api/admin/audit', plain.cookie)).statusCode).toBe(403);
  });

  it('edits and deletes custom roles, never system roles', async () => {
    const role = (await createRole(owner, 'Reviewer', ['issue.read'])).json<AdminRole>();
    const updated = await call('PUT', `/api/admin/roles/${role.id}`, owner, {
      name: 'Reviewers',
      permissions: ['issue.read', 'comment.create'],
    });
    expect(updated.json()).toMatchObject({
      name: 'Reviewers',
      permissions: ['comment.create', 'issue.read'],
    });

    const system = roles.find((r) => r.key === 'member')!;
    expect(
      (
        await call('PUT', `/api/admin/roles/${system.id}`, owner, { name: 'X', permissions: [] })
      ).json(),
    ).toEqual({ error: 'system_role' });
    expect((await call('DELETE', `/api/admin/roles/${system.id}`, owner)).statusCode).toBe(409);
    expect((await createRole(owner, 'reviewers', [])).json()).toEqual({ error: 'role_name_taken' });

    // A role in use stays until nobody holds it.
    const person = await invite('aysel', role.id);
    expect((await call('DELETE', `/api/admin/roles/${role.id}`, owner)).json()).toEqual({
      error: 'role_in_use',
    });
    const member = (await call('GET', '/api/admin/members', owner))
      .json<AdminMember[]>()
      .find((m) => m.id === person.id)!;
    await call(
      'DELETE',
      `/api/admin/members/${person.id}/roles/${member.roles[0]!.assignmentId}`,
      owner,
    );
    expect((await call('DELETE', `/api/admin/roles/${role.id}`, owner)).statusCode).toBe(204);
    expect(
      (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>().map((r) => r.id),
    ).not.toContain(role.id);
  });

  it('cannot grant permissions the editor does not hold, nor installation settings', async () => {
    const manager = (
      await createRole(owner, 'Role manager', ['role.create', 'role.update', 'member.role.assign'])
    ).json<AdminRole>();
    const person = await invite('aysel', manager.id);
    expect((await createRole(person.cookie, 'Helper', ['role.create'])).statusCode).toBe(201);
    expect((await createRole(person.cookie, 'Boss', ['org.manage'])).statusCode).toBe(403);
    expect((await createRole(owner, 'Root', ['instance.manage'])).statusCode).toBe(400);
    const plain = await invite('rauf');
    expect((await createRole(plain.cookie, 'Mine', [])).statusCode).toBe(403);
  });
});

describe('audit log (SPEC §9, MVP criterion 5)', () => {
  it('shows role changes newest first with filters and pages', async () => {
    const role = (await createRole(owner, 'Auditor', ['org.audit.read'])).json<AdminRole>();
    await invite('aysel', role.id);
    await call('PUT', `/api/admin/roles/${role.id}`, owner, { name: 'Auditors', permissions: [] });

    const all = (await call('GET', '/api/admin/audit', owner)).json<AuditPage>();
    expect(all.entries[0]).toMatchObject({
      action: 'role.updated',
      actor: { type: 'member', name: OWNER.name },
      before: { name: 'Auditor' },
      after: { name: 'Auditors' },
    });
    expect(all.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['role.created', 'member.invited']),
    );

    const roleRows = (
      await call('GET', '/api/admin/audit?targetType=role&limit=1', owner)
    ).json<AuditPage>();
    expect(roleRows.entries.map((e) => e.action)).toEqual(['role.updated']);
    const older = (
      await call('GET', `/api/admin/audit?targetType=role&limit=1&before=${roleRows.next}`, owner)
    ).json<AuditPage>();
    expect(older).toMatchObject({ entries: [{ action: 'role.created' }], next: null });

    expect((await call('GET', '/api/admin/audit?limit=999', owner)).statusCode).toBe(400);
  });
});
