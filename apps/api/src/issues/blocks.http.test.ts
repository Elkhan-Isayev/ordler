import type {
  AdminRole,
  InviteResponse,
  IssueDetail,
  IssueSummary,
  TeamView,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { LocalEventBus, type DomainEvent } from '../realtime/event-bus.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let events: DomainEvent[];
let departmentId: string;
let helpdeskId: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function person(
  email: string,
  role?: { key: string; scope: object },
): Promise<{ cookie: string; id: string }> {
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email,
      name: email.split('@')[0],
      ...(role
        ? { role: { roleId: roles.find((r) => r.key === role.key)!.id, scope: role.scope } }
        : {}),
      teamIds: [],
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: invite.inviteUrl.split('/invite/')[1]!,
    name: email.split('@')[0],
    password: 'person-password-1',
  });
  return {
    cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE),
    id: invite.member.id,
  };
}

const issue = async (identifier: string, cookie = owner) =>
  (await call('GET', `/api/issues/${identifier}`, cookie)).json<IssueDetail>();
const ids = (list: IssueSummary[]) => list.map((i) => i.identifier);

beforeEach(async () => {
  const bus = new LocalEventBus();
  events = [];
  bus.subscribe((event) => {
    if (event.type === 'issue.changed') events.push(event);
  });
  t = await createTestApp({ events: bus });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  departmentId = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>().id;
  helpdeskId = (
    await call('POST', `/api/admin/departments/${departmentId}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
    })
  ).json<{ id: string }>().id;
  for (const title of ['Replace the projector', 'Order a new projector', 'Book the room']) {
    await call('POST', '/api/teams/HELP/issues', owner, { title });
  }
});
afterEach(() => t.close());

describe('blocked by / blocking', () => {
  it('shows the relation on both issues, with history and events on each', async () => {
    events = [];
    const res = await call('PATCH', '/api/issues/HELP-1', owner, { blockedBy: ['help-2'] });
    expect(res.statusCode).toBe(200);
    expect(ids(res.json<IssueDetail>().blockedBy)).toEqual(['HELP-2']);
    expect(res.json<IssueDetail>().blocked).toBe(true);

    const other = await issue('HELP-2');
    expect(ids(other.blocking)).toEqual(['HELP-1']);
    expect(other.blocked).toBe(false);
    expect(other.events.at(-1)!.changes).toEqual({ blocking: { from: [], to: ['HELP-1'] } });
    expect((await issue('HELP-1')).events.at(-1)!.changes).toEqual({
      blockedBy: { from: [], to: ['HELP-2'] },
    });
    expect(new Set(events.map((e) => (e as { issueId: string }).issueId))).toEqual(
      new Set([other.id, (await issue('HELP-1')).id]),
    );
  });

  it('adds from the blocking side and marks the waiting issue in lists until the blocker is done', async () => {
    await call('PATCH', '/api/issues/HELP-2', owner, { blocking: ['HELP-1', 'HELP-3'] });
    const list = (await call('GET', '/api/teams/HELP/issues', owner)).json<IssueSummary[]>();
    expect(Object.fromEntries(list.map((i) => [i.identifier, i.blocked]))).toEqual({
      'HELP-1': true,
      'HELP-2': false,
      'HELP-3': true,
    });

    const team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
    const done = team.statuses.find((s) => s.category === 'completed')!;
    await call('PATCH', '/api/issues/HELP-2', owner, { statusId: done.id });
    expect((await issue('HELP-1')).blocked).toBe(false);
    // Done blockers stay listed; they only stop counting as blocking.
    expect(ids((await issue('HELP-1')).blockedBy)).toEqual(['HELP-2']);
  });

  it('removes a relation on both sides', async () => {
    await call('PATCH', '/api/issues/HELP-1', owner, { blockedBy: ['HELP-2', 'HELP-3'] });
    await call('PATCH', '/api/issues/HELP-2', owner, { blocking: [] });
    expect(ids((await issue('HELP-1')).blockedBy)).toEqual(['HELP-3']);
    expect((await issue('HELP-2')).blocking).toEqual([]);
    expect((await issue('HELP-1')).events.at(-1)!.changes).toEqual({
      blockedBy: { from: ['HELP-2'], to: [] },
    });
  });

  it('rejects an issue blocking itself or blocking and waiting on the same issue', async () => {
    const self = await call('PATCH', '/api/issues/HELP-1', owner, { blockedBy: ['HELP-1'] });
    expect(self.statusCode).toBe(400);
    expect(self.json()).toEqual({ error: 'invalid_relation' });

    const both = await call('PATCH', '/api/issues/HELP-1', owner, {
      blockedBy: ['HELP-2'],
      blocking: ['HELP-2'],
    });
    expect(both.json()).toEqual({ error: 'invalid_relation' });

    await call('PATCH', '/api/issues/HELP-1', owner, { blockedBy: ['HELP-2'] });
    const reverse = await call('PATCH', '/api/issues/HELP-1', owner, { blocking: ['HELP-2'] });
    expect(reverse.json()).toEqual({ error: 'invalid_relation' });
    expect(
      (await call('PATCH', '/api/issues/HELP-1', owner, { blockedBy: ['NOPE-9'] })).statusCode,
    ).toBe(404);
  });

  it('lets viewers see relations but not change them', async () => {
    await call('PATCH', '/api/issues/HELP-1', owner, { blockedBy: ['HELP-2'] });
    const viewer = await person('vic@push30.test', {
      key: 'viewer',
      scope: { type: 'team', id: helpdeskId },
    });
    expect(ids((await issue('HELP-1', viewer.cookie)).blockedBy)).toEqual(['HELP-2']);
    const res = await call('PATCH', '/api/issues/HELP-1', viewer.cookie, { blockedBy: [] });
    expect(res.statusCode).toBe(403);
    expect(ids((await issue('HELP-1')).blockedBy)).toEqual(['HELP-2']);
  });

  it('hides blockers in teams the reader cannot see, and keeps them when the reader edits the list', async () => {
    await call('POST', `/api/admin/departments/${departmentId}/teams`, owner, {
      name: 'Security',
      key: 'SEC',
      isPrivate: true,
    });
    await call('POST', '/api/teams/SEC/issues', owner, { title: 'Audit the badge readers' });
    await call('PATCH', '/api/issues/HELP-1', owner, { blockedBy: ['SEC-1'] });

    const member = await person('dee@push30.test', {
      key: 'member',
      scope: { type: 'department', id: departmentId },
    });
    expect((await issue('HELP-1', member.cookie)).blockedBy).toEqual([]);
    expect(
      (await call('PATCH', '/api/issues/HELP-1', member.cookie, { blockedBy: ['SEC-1'] }))
        .statusCode,
    ).toBe(404);
    await call('PATCH', '/api/issues/HELP-1', member.cookie, { blockedBy: ['HELP-2'] });
    expect(ids((await issue('HELP-1')).blockedBy)).toEqual(['SEC-1', 'HELP-2']);
  });
});
