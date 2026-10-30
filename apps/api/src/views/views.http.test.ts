import type { AdminRole, InviteResponse, SavedView, TeamView } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../db/schema.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];
let itId: string;
type Person = 'anna' | 'boris' | 'lead' | 'outsider';
const people = {} as Record<Person, { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function person(name: Person, role: string, departmentId: string) {
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name}@push30.test`,
      name,
      role: {
        roleId: roles.find((r) => r.key === role)!.id,
        scope: { type: 'department', id: departmentId },
      },
      teamIds: [],
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: invite.inviteUrl.split('/invite/')[1]!,
    name,
    password: 'person-password-1',
  });
  people[name] = {
    cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE),
    id: invite.member.id,
  };
}

beforeEach(async () => {
  t = await createTestApp();
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const dept = async (name: string) =>
    (await call('POST', '/api/admin/departments', owner, { name })).json<{ id: string }>().id;
  itId = await dept('IT');
  const financeId = await dept('Finance');
  await call('POST', `/api/admin/departments/${itId}/teams`, owner, {
    name: 'Helpdesk',
    key: 'HELP',
    isPrivate: false,
  });
  await person('anna', 'member', itId);
  await person('boris', 'member', itId);
  await person('lead', 'department_admin', itId);
  await person('outsider', 'member', financeId);
});
afterEach(() => t.close());

const save = (cookie: string, payload: object) =>
  call('POST', '/api/teams/HELP/views', cookie, payload);
const teamViews = async (cookie: string) =>
  (await call('GET', '/api/teams/HELP/views', cookie)).json<SavedView[]>();

describe('personal views (SPEC §5.4)', () => {
  it('saves filters and a layout that only the owner sees and changes', async () => {
    const created = await save(people.anna.cookie, {
      name: 'My urgent',
      layout: 'board',
      filters: { priority: 'urgent', assignee: people.anna.id },
    });
    expect(created.statusCode).toBe(201);
    const view = created.json<SavedView>();
    expect(view).toMatchObject({
      name: 'My urgent',
      layout: 'board',
      filters: { priority: 'urgent', assignee: people.anna.id },
      shared: false,
      team: { key: 'HELP' },
      owner: { id: people.anna.id, name: 'anna' },
      canEdit: true,
    });

    expect((await teamViews(people.boris.cookie)).map((v) => v.id)).toEqual([]);
    expect((await call('GET', `/api/views/${view.id}`, people.boris.cookie)).statusCode).toBe(404);
    const renamed = await call('PATCH', `/api/views/${view.id}`, people.boris.cookie, {
      name: 'Hijacked',
    });
    expect(renamed.statusCode).toBe(404);

    const edited = await call('PATCH', `/api/views/${view.id}`, people.anna.cookie, {
      layout: 'timeline',
      filters: {},
    });
    expect(edited.json<SavedView>()).toMatchObject({ layout: 'timeline', filters: {} });
    expect((await call('DELETE', `/api/views/${view.id}`, people.anna.cookie)).statusCode).toBe(
      204,
    );
    expect(await teamViews(people.anna.cookie)).toEqual([]);
  });

  it('refuses unknown filter keys and teams the member cannot read', async () => {
    expect(
      (await save(people.anna.cookie, { name: 'X', filters: { title: 'a' } })).statusCode,
    ).toBe(400);
    expect((await save(people.outsider.cookie, { name: 'Peek' })).statusCode).toBe(404);
  });
});

describe('shared views', () => {
  it('needs view.create_shared to share, and everyone in the team sees the result', async () => {
    const denied = await save(people.anna.cookie, { name: 'Team triage', shared: true });
    expect(denied.statusCode).toBe(403);

    const shared = (
      await save(people.lead.cookie, {
        name: 'Team triage',
        shared: true,
        filters: { assignee: 'none' },
      })
    ).json<SavedView>();
    const seen = await teamViews(people.anna.cookie);
    expect(seen).toEqual([
      expect.objectContaining({ id: shared.id, shared: true, canEdit: false }),
    ]);
    expect((await call('GET', '/api/views', people.anna.cookie)).json<SavedView[]>()).toHaveLength(
      1,
    );
    expect((await call('GET', '/api/views', people.outsider.cookie)).json<SavedView[]>()).toEqual(
      [],
    );

    // A member without the permission can neither change nor delete it.
    expect(
      (await call('PATCH', `/api/views/${shared.id}`, people.anna.cookie, { name: 'Mine' }))
        .statusCode,
    ).toBe(403);
    expect((await call('DELETE', `/api/views/${shared.id}`, people.anna.cookie)).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/api/views/${shared.id}`, owner)).statusCode).toBe(204);

    const audit = await t.database.db.select().from(auditLog);
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['view.created', 'view.deleted']),
    );
  });

  it('lets a member publish a personal view only with the permission', async () => {
    const mine = (await save(people.anna.cookie, { name: 'Mine' })).json<SavedView>();
    const publish = await call('PATCH', `/api/views/${mine.id}`, people.anna.cookie, {
      shared: true,
    });
    expect(publish.statusCode).toBe(403);

    const leads = (await save(people.lead.cookie, { name: 'Draft' })).json<SavedView>();
    const published = await call('PATCH', `/api/views/${leads.id}`, people.lead.cookie, {
      shared: true,
    });
    expect(published.json<SavedView>().shared).toBe(true);
    expect((await teamViews(people.boris.cookie)).map((v) => v.name)).toEqual(['Draft']);
  });

  it('keeps fields a change leaves out', async () => {
    const shared = (
      await save(people.lead.cookie, {
        name: 'Board',
        layout: 'board',
        shared: true,
        filters: { priority: 'high' },
      })
    ).json<SavedView>();
    const renamed = await call('PATCH', `/api/views/${shared.id}`, people.lead.cookie, {
      name: 'Renamed',
    });
    expect(renamed.json<SavedView>()).toMatchObject({
      name: 'Renamed',
      layout: 'board',
      shared: true,
      filters: { priority: 'high' },
    });
  });

  it('tells the team page whether the viewer may share views', async () => {
    const team = async (cookie: string) =>
      (await call('GET', '/api/teams/HELP', cookie)).json<TeamView>().can.shareViews;
    expect(await team(people.anna.cookie)).toBe(false);
    expect(await team(people.lead.cookie)).toBe(true);
  });
});
