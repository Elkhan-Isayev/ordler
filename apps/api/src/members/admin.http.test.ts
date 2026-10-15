import type { AdminDepartment, AdminMember, AdminRole, InviteResponse } from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../db/schema.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function call(method: Method, url: string, cookie: string, payload?: unknown) {
  return t.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

async function roleId(key: string): Promise<string> {
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  return roles.find((r) => r.key === key)!.id;
}

/** Invites someone and accepts the invite, returning their session cookie and id. */
async function onboard(email: string, role?: { key: string; scope: object }) {
  const invited = await call('POST', '/api/admin/members', owner, {
    email,
    name: 'New Person',
    ...(role ? { role: { roleId: await roleId(role.key), scope: role.scope } } : {}),
  });
  expect(invited.statusCode).toBe(201);
  const body = invited.json<InviteResponse>();
  const token = body.inviteUrl.split('/invite/')[1]!;
  const accepted = await t.app.inject({
    method: 'POST',
    url: '/api/invites/accept',
    payload: { token, name: 'New Person', password: 'new-person-pass-1' },
  });
  expect(accepted.statusCode).toBe(200);
  return { id: body.member.id, cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE) };
}

beforeEach(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
});
afterEach(() => t.close());

describe('departments and teams', () => {
  it('creates, lists, renames and archives', async () => {
    const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
      id: string;
    }>();
    const team = await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
    });
    expect(team.statusCode).toBe(201);
    expect(
      (await call('PATCH', `/api/admin/departments/${it.id}`, owner, { name: 'IT Ops' }))
        .statusCode,
    ).toBe(204);

    let list = (await call('GET', '/api/admin/departments', owner)).json<AdminDepartment[]>();
    expect(list).toEqual([
      expect.objectContaining({
        name: 'IT Ops',
        archivedAt: null,
        teams: [expect.objectContaining({ key: 'HELP', name: 'Helpdesk', memberCount: 0 })],
      }),
    ]);

    expect((await call('POST', `/api/admin/departments/${it.id}/archive`, owner)).statusCode).toBe(
      204,
    );
    list = (await call('GET', '/api/admin/departments', owner)).json<AdminDepartment[]>();
    expect(list[0]!.archivedAt).not.toBeNull();
    expect(list[0]!.teams[0]!.archivedAt).not.toBeNull();

    const actions = (await t.database.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'department.created',
        'team.created',
        'department.updated',
        'department.archived',
      ]),
    );
  });

  it('rejects duplicate team keys and names, and bad keys', async () => {
    const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
      id: string;
    }>();
    await call('POST', `/api/admin/departments/${it.id}/teams`, owner, { name: 'A', key: 'HELP' });
    const dupKey = await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
      name: 'B',
      key: 'HELP',
    });
    expect(dupKey.json()).toEqual({ error: 'team_key_taken' });
    const dupName = await call('POST', '/api/admin/departments', owner, { name: 'it' });
    expect(dupName.json()).toEqual({ error: 'department_name_taken' });
    const badKey = await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
      name: 'C',
      key: 'help',
    });
    expect(badKey.statusCode).toBe(400);
  });

  it('refuses teams in archived departments', async () => {
    const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
      id: string;
    }>();
    await call('POST', `/api/admin/departments/${it.id}/archive`, owner);
    const response = await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
      name: 'A',
      key: 'AA',
    });
    expect(response.json()).toEqual({ error: 'archived' });
  });
});

describe('invitations', () => {
  it('creates an invited member with a one-time link the invitee accepts', async () => {
    const invited = await call('POST', '/api/admin/members', owner, {
      email: 'Ann@Push30.test',
      name: 'Ann',
    });
    const body = invited.json<InviteResponse>();
    expect(body.member).toMatchObject({ email: 'ann@push30.test', status: 'invited' });
    expect(body.inviteUrl).toMatch(/^https:\/\/ordler\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(body.emailed).toBe(true);
    expect(t.mailer.sent[0]).toMatchObject({ to: 'ann@push30.test' });
    expect(t.mailer.sent[0]!.text).toContain(body.inviteUrl);

    const token = body.inviteUrl.split('/invite/')[1]!;
    const peek = await t.app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(peek.json()).toEqual({ email: 'ann@push30.test', companyName: 'Push30' });

    const accepted = await t.app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      payload: { token, name: 'Ann Lee', password: 'ann-password-123' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      member: { name: 'Ann Lee', email: 'ann@push30.test' },
    });

    const again = await t.app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      payload: { token, name: 'Mallory', password: 'mallory-password' },
    });
    expect(again.statusCode).toBe(410);
    expect(again.json()).toEqual({ error: 'invite_invalid' });

    const signIn = await t.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { email: 'ann@push30.test', password: 'ann-password-123' },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it('rejects taken emails and unknown tokens', async () => {
    expect(
      (await call('POST', '/api/admin/members', owner, { email: OWNER.email, name: 'X' })).json(),
    ).toEqual({
      error: 'email_taken',
    });
    const peek = await t.app.inject({ method: 'GET', url: `/api/invites/${'x'.repeat(43)}` });
    expect(peek.statusCode).toBe(410);
  });

  it('re-invites with a new link and retires the old one', async () => {
    const first = (
      await call('POST', '/api/admin/members', owner, { email: 'b@push30.test', name: 'B' })
    ).json<InviteResponse>();
    const second = (
      await call('POST', `/api/admin/members/${first.member.id}/invite`, owner)
    ).json<{ inviteUrl: string }>();
    expect(second.inviteUrl).not.toBe(first.inviteUrl);
    const oldToken = first.inviteUrl.split('/invite/')[1]!;
    expect(
      (await t.app.inject({ method: 'GET', url: `/api/invites/${oldToken}` })).statusCode,
    ).toBe(410);
  });

  it('grants the initial role and teams', async () => {
    const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
      id: string;
    }>();
    const team = (
      await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
        name: 'Helpdesk',
        key: 'HELP',
      })
    ).json<{ id: string }>();
    const invited = await call('POST', '/api/admin/members', owner, {
      email: 'lead@push30.test',
      name: 'Lead',
      role: { roleId: await roleId('team_lead'), scope: { type: 'team', id: team.id } },
      teamIds: [team.id],
    });
    expect(invited.json<InviteResponse>().member).toMatchObject({
      teamIds: [team.id],
      roles: [
        expect.objectContaining({ roleKey: 'team_lead', scope: { type: 'team', id: team.id } }),
      ],
    });
  });
});

describe('roles and status', () => {
  it('assigns and removes roles at a scope', async () => {
    const dept = (await call('POST', '/api/admin/departments', owner, { name: 'Finance' })).json<{
      id: string;
    }>();
    const person = await onboard('p@push30.test');
    const granted = await call('POST', `/api/admin/members/${person.id}/roles`, owner, {
      roleId: await roleId('department_supervisor'),
      scope: { type: 'department', id: dept.id },
    });
    const member = granted.json<AdminMember>();
    expect(member.roles).toEqual([
      expect.objectContaining({
        roleKey: 'department_supervisor',
        scope: { type: 'department', id: dept.id },
      }),
    ]);
    const removed = await call(
      'DELETE',
      `/api/admin/members/${person.id}/roles/${member.roles[0]!.assignmentId}`,
      owner,
    );
    expect(removed.json<AdminMember>().roles).toEqual([]);
  });

  it('lets only Owners grant the Owner role', async () => {
    const admin = await onboard('admin@push30.test', {
      key: 'org_admin',
      scope: { type: 'organization' },
    });
    const target = await onboard('t@push30.test');
    const response = await call('POST', `/api/admin/members/${target.id}/roles`, admin.cookie, {
      roleId: await roleId('owner'),
      scope: { type: 'organization' },
    });
    expect(response.json()).toEqual({ error: 'owner_only' });
  });

  it('never leaves the organization without an active Owner', async () => {
    const me = (await call('GET', '/api/me', owner)).json<{ member: { id: string } }>();
    const members = (await call('GET', '/api/admin/members', owner)).json<AdminMember[]>();
    const ownerAssignment = members.find((m) => m.id === me.member.id)!.roles[0]!;
    const removeOwn = await call(
      'DELETE',
      `/api/admin/members/${me.member.id}/roles/${ownerAssignment.assignmentId}`,
      owner,
    );
    expect(removeOwn.json()).toEqual({ error: 'last_owner' });
    const deactivateSelf = await call('PATCH', `/api/admin/members/${me.member.id}`, owner, {
      status: 'deactivated',
    });
    expect(deactivateSelf.json()).toEqual({ error: 'cannot_change_self' });
  });

  it('deactivation ends sessions immediately, reactivation restores access', async () => {
    const person = await onboard('d@push30.test');
    expect((await call('GET', '/api/me', person.cookie)).statusCode).toBe(200);
    const off = await call('PATCH', `/api/admin/members/${person.id}`, owner, {
      status: 'deactivated',
    });
    expect(off.json<AdminMember>().status).toBe('deactivated');
    expect((await call('GET', '/api/me', person.cookie)).statusCode).toBe(401);
    const on = await call('PATCH', `/api/admin/members/${person.id}`, owner, { status: 'active' });
    expect(on.json<AdminMember>().status).toBe('active');
  });

  it('adds members to teams and the sidebar shows them', async () => {
    const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
      id: string;
    }>();
    const team = (
      await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
        name: 'Helpdesk',
        key: 'HELP',
      })
    ).json<{ id: string }>();
    const person = await onboard('m@push30.test');
    expect(
      (
        await call('PUT', `/api/admin/teams/${team.id}/members/${person.id}`, owner)
      ).json<AdminMember>().teamIds,
    ).toEqual([team.id]);
    const me = (await call('GET', '/api/me', person.cookie)).json<{
      departments: Array<{ name: string }>;
    }>();
    expect(me.departments.map((d) => d.name)).toEqual(['IT']);
    expect(
      (
        await call('DELETE', `/api/admin/teams/${team.id}/members/${person.id}`, owner)
      ).json<AdminMember>().teamIds,
    ).toEqual([]);
  });
});

describe('access control', () => {
  it('forbids admin endpoints to plain members', async () => {
    const member = await onboard('plain@push30.test', {
      key: 'member',
      scope: { type: 'organization' },
    });
    for (const [method, url] of [
      ['GET', '/api/admin/departments'],
      ['POST', '/api/admin/departments'],
      ['GET', '/api/admin/members'],
      ['POST', '/api/admin/members'],
      ['GET', '/api/admin/roles'],
    ] as const) {
      const response = await call(method, url, member.cookie, method === 'POST' ? {} : undefined);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('lets a department admin create teams only in their department', async () => {
    const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
      id: string;
    }>();
    const finance = (
      await call('POST', '/api/admin/departments', owner, { name: 'Finance' })
    ).json<{ id: string }>();
    const deptAdmin = await onboard('da@push30.test', {
      key: 'department_admin',
      scope: { type: 'department', id: it.id },
    });
    expect(
      (
        await call('POST', `/api/admin/departments/${it.id}/teams`, deptAdmin.cookie, {
          name: 'Infra',
          key: 'INFRA',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call('POST', `/api/admin/departments/${finance.id}/teams`, deptAdmin.cookie, {
          name: 'Acc',
          key: 'ACC',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('records who did what', async () => {
    await call('POST', '/api/admin/members', owner, { email: 'audit@push30.test', name: 'Audit' });
    const [entry] = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'member.invited'));
    expect(entry).toMatchObject({ actorType: 'member', targetType: 'member' });
  });
});
