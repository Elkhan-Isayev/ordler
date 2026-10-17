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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function roleId(key: string): Promise<string> {
  return (await call('GET', '/api/admin/roles', owner))
    .json<AdminRole[]>()
    .find((r) => r.key === key)!.id;
}

/** Invites, accepts and optionally grants a role; returns the session cookie and id. */
async function person(
  email: string,
  options: { role?: string; scope?: object; teams?: string[] } = {},
): Promise<{ cookie: string; id: string }> {
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email,
      name: email.split('@')[0],
      ...(options.role
        ? { role: { roleId: await roleId(options.role), scope: options.scope } }
        : {}),
      teamIds: options.teams ?? [],
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

async function createTeam(name: string, key: string, isPrivate = false): Promise<string> {
  return (
    await call('POST', `/api/admin/departments/${departmentId}/teams`, owner, {
      name,
      key,
      isPrivate,
    })
  ).json<{ id: string }>().id;
}

beforeEach(async () => {
  const bus = new LocalEventBus();
  events = [];
  bus.subscribe((event) => events.push(event));
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
  helpdeskId = await createTeam('Helpdesk', 'HELP');
});
afterEach(() => t.close());

describe('team issues', () => {
  it('gives a new team the default workflow', async () => {
    const team = (await call('GET', '/api/teams/help', owner)).json<TeamView>();
    expect(team.statuses.map((s) => [s.key, s.category])).toEqual([
      ['backlog', 'backlog'],
      ['todo', 'unstarted'],
      ['in_progress', 'started'],
      ['in_review', 'started'],
      ['done', 'completed'],
      ['canceled', 'canceled'],
    ]);
    expect(team.can).toEqual({ create: true, update: true, assign: true });
  });

  it('numbers issues per team, starts them in the default status and records history', async () => {
    const first = await call('POST', '/api/teams/HELP/issues', owner, { title: 'Laptop broken' });
    expect(first.statusCode).toBe(201);
    const issue = first.json<IssueDetail>();
    const team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
    expect(issue).toMatchObject({
      identifier: 'HELP-1',
      title: 'Laptop broken',
      priority: 'none',
      statusId: team.statuses.find((s) => s.key === 'todo')!.id,
      events: [expect.objectContaining({ kind: 'created' })],
    });
    const second = (
      await call('POST', '/api/teams/HELP/issues', owner, { title: 'VPN' })
    ).json<IssueDetail>();
    expect(second.identifier).toBe('HELP-2');
    // Newest first inside the column.
    expect(second.sortOrder).toBeLessThan(issue.sortOrder);

    const list = (await call('GET', '/api/teams/HELP/issues', owner)).json<IssueSummary[]>();
    expect(list.map((i) => i.identifier)).toEqual(['HELP-2', 'HELP-1']);
    expect(events).toEqual([
      { type: 'issue.changed', teamId: helpdeskId, issueId: issue.id },
      { type: 'issue.changed', teamId: helpdeskId, issueId: second.id },
    ]);
  });

  it('updates fields, records each change and publishes it', async () => {
    const ann = await person('ann@push30.test', { teams: [helpdeskId] });
    const team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Printer' });
    const done = team.statuses.find((s) => s.key === 'done')!.id;
    events.length = 0;

    const updated = await call('PATCH', '/api/issues/help-1', owner, {
      statusId: done,
      priority: 'high',
      assigneeId: ann.id,
    });
    expect(updated.statusCode).toBe(200);
    const issue = updated.json<IssueDetail>();
    expect(issue).toMatchObject({ statusId: done, priority: 'high', assignee: { id: ann.id } });
    expect(issue.events.at(-1)).toMatchObject({
      kind: 'updated',
      actor: { name: 'Owner' },
      changes: {
        statusId: { to: done },
        priority: { from: 'none', to: 'high' },
        assigneeId: { from: null, to: ann.id },
      },
    });
    expect(events).toHaveLength(1);

    // Reordering inside a column is not history.
    await call('PATCH', '/api/issues/HELP-1', owner, { sortOrder: 42 });
    expect(
      (await call('GET', '/api/issues/HELP-1', owner)).json<IssueDetail>().events,
    ).toHaveLength(2);

    const mine = (await call('GET', '/api/me/issues', ann.cookie)).json<IssueSummary[]>();
    expect(mine).toEqual([]); // Ann has no role on the team yet, so she cannot read it.
  });

  it('rejects statuses of another team and assignees outside the team', async () => {
    await createTeam('Infrastructure', 'INFRA');
    const infra = (await call('GET', '/api/teams/INFRA', owner)).json<TeamView>();
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Disk' });
    const outsider = await person('bob@push30.test');

    expect(
      (
        await call('PATCH', '/api/issues/HELP-1', owner, { statusId: infra.statuses[0]!.id })
      ).json(),
    ).toEqual({ error: 'status_not_in_workflow' });
    expect(
      (await call('PATCH', '/api/issues/HELP-1', owner, { assigneeId: outsider.id })).json(),
    ).toEqual({ error: 'assignee_not_in_team' });
  });

  it('validates input', async () => {
    expect((await call('POST', '/api/teams/HELP/issues', owner, { title: ' ' })).statusCode).toBe(
      400,
    );
    expect((await call('PATCH', '/api/issues/HELP-1', owner, {})).statusCode).toBe(400);
  });
});

describe('issue permissions', () => {
  it('lets team members with the Member role work and see their issues', async () => {
    const ann = await person('ann@push30.test', {
      role: 'member',
      scope: { type: 'team', id: helpdeskId },
      teams: [helpdeskId],
    });
    const created = await call('POST', '/api/teams/HELP/issues', ann.cookie, {
      title: 'Mouse',
      assigneeId: ann.id,
    });
    expect(created.statusCode).toBe(201);
    const mine = (await call('GET', '/api/me/issues', ann.cookie)).json<IssueSummary[]>();
    expect(mine.map((i) => i.identifier)).toEqual(['HELP-1']);
  });

  it('lets viewers read but not create or change', async () => {
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Monitor' });
    const viewer = await person('vic@push30.test', {
      role: 'viewer',
      scope: { type: 'team', id: helpdeskId },
    });
    expect((await call('GET', '/api/teams/HELP', viewer.cookie)).json<TeamView>().can).toEqual({
      create: false,
      update: false,
      assign: false,
    });
    expect((await call('GET', '/api/issues/HELP-1', viewer.cookie)).statusCode).toBe(200);
    expect(
      (await call('POST', '/api/teams/HELP/issues', viewer.cookie, { title: 'x' })).json(),
    ).toEqual({ error: 'forbidden' });
    expect(
      (await call('PATCH', '/api/issues/HELP-1', viewer.cookie, { title: 'changed' })).statusCode,
    ).toBe(403);
  });

  it('hides teams from members without any role on them', async () => {
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Keyboard' });
    const stranger = await person('sam@push30.test');
    expect((await call('GET', '/api/teams/HELP', stranger.cookie)).statusCode).toBe(404);
    expect((await call('GET', '/api/issues/HELP-1', stranger.cookie)).statusCode).toBe(404);
    expect((await call('GET', '/api/teams/HELP/issues', stranger.cookie)).statusCode).toBe(404);
  });

  it('shows private teams only to their members', async () => {
    const secretId = await createTeam('Security', 'SEC', true);
    const deptMember = await person('dee@push30.test', {
      role: 'member',
      scope: { type: 'department', id: departmentId },
    });
    expect((await call('GET', '/api/teams/SEC', deptMember.cookie)).statusCode).toBe(404);
    expect((await call('GET', '/api/teams/HELP', deptMember.cookie)).statusCode).toBe(200);

    await call('PUT', `/api/admin/teams/${secretId}/members/${deptMember.id}`, owner);
    expect((await call('GET', '/api/teams/SEC', deptMember.cookie)).statusCode).toBe(200);
  });

  it('requires a session', async () => {
    expect((await call('GET', '/api/teams/HELP')).statusCode).toBe(401);
    expect((await call('GET', '/api/me/issues')).statusCode).toBe(401);
  });
});
