import type {
  AdminRole,
  InviteResponse,
  IssueDetail,
  TeamView,
  WorkflowStatus,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import type { DomainEvent } from '../realtime/event-bus.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let dev: string;
let team: TeamView;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}
const names = (statuses: WorkflowStatus[]) => statuses.map((s) => s.name);
const byName = (name: string) => team.statuses.find((s) => s.name === name)!;
const refresh = async () => {
  team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
};

beforeEach(async () => {
  t = await createTestApp();
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const dept = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>();
  await call('POST', `/api/admin/departments/${dept.id}/teams`, owner, {
    name: 'Helpdesk',
    key: 'HELP',
  });
  await refresh();
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: 'dev@push30.test',
      name: 'dev',
      role: {
        roleId: roles.find((r) => r.key === 'member')!.id,
        scope: { type: 'team', id: team.id },
      },
      teamIds: [team.id],
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: invite.inviteUrl.split('/invite/')[1]!,
    name: 'dev',
    password: 'person-password-1',
  });
  dev = cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE);
});
afterEach(() => t.close());

describe('workflow editor (SPEC §5.2)', () => {
  it('adds a status inside its category and tells open boards', async () => {
    const events: DomainEvent[] = [];
    t.ctx.events.subscribe((event) => events.push(event));
    const added = await call('POST', '/api/teams/HELP/statuses', owner, {
      name: 'QA',
      category: 'started',
    });
    expect(added.statusCode).toBe(201);
    expect(names(added.json<WorkflowStatus[]>())).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'In Review',
      'QA',
      'Done',
      'Canceled',
    ]);
    expect(events).toContainEqual({ type: 'team.changed', teamId: team.id });
  });

  it('reorders within categories only', async () => {
    const ids = [...team.statuses].reverse().map((s) => s.id);
    const reordered = (await call('PUT', '/api/teams/HELP/statuses/order', owner, { ids })).json<
      WorkflowStatus[]
    >();
    // Categories keep their order; In Review now comes before In Progress.
    expect(names(reordered)).toEqual([
      'Backlog',
      'Todo',
      'In Review',
      'In Progress',
      'Done',
      'Canceled',
    ]);
    expect(
      (await call('PUT', '/api/teams/HELP/statuses/order', owner, { ids: ids.slice(1) }))
        .statusCode,
    ).toBe(400);
  });

  it('renames, changes the default and archives unused statuses', async () => {
    const renamed = (
      await call('PATCH', `/api/statuses/${byName('Todo').id}`, owner, { name: 'To do' })
    ).json<WorkflowStatus[]>();
    // The custom name replaces the translated default.
    expect(renamed.find((s) => s.name === 'To do')).toMatchObject({ key: null, isDefault: true });

    await call('PATCH', `/api/statuses/${byName('Backlog').id}`, owner, { isDefault: true });
    await refresh();
    expect(team.statuses.filter((s) => s.isDefault).map((s) => s.name)).toEqual(['Backlog']);
    const created = (
      await call('POST', '/api/teams/HELP/issues', owner, { title: 'x' })
    ).json<IssueDetail>();
    expect(created.status.name).toBe('Backlog');

    expect((await call('DELETE', `/api/statuses/${byName('Backlog').id}`, owner)).json()).toEqual({
      error: 'status_required',
    });
    expect((await call('DELETE', `/api/statuses/${byName('Canceled').id}`, owner)).json()).toEqual({
      error: 'status_required',
    });
    await call('PATCH', `/api/issues/${created.identifier}`, owner, {
      statusId: byName('In Review').id,
    });
    expect((await call('DELETE', `/api/statuses/${byName('In Review').id}`, owner)).json()).toEqual(
      {
        error: 'status_in_use',
      },
    );
    const archived = (
      await call('DELETE', `/api/statuses/${byName('In Progress').id}`, owner)
    ).json<WorkflowStatus[]>();
    expect(names(archived)).not.toContain('In Progress');
    expect(archived.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is limited to people who manage the team', async () => {
    expect(
      (await call('POST', '/api/teams/HELP/statuses', dev, { name: 'QA', category: 'started' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/api/statuses/${byName('Todo').id}`, dev, { name: 'x' })).statusCode,
    ).toBe(403);
    expect((await call('DELETE', `/api/statuses/${byName('In Review').id}`, dev)).statusCode).toBe(
      403,
    );
    expect(
      (
        await call('PUT', '/api/teams/HELP/statuses/order', dev, {
          ids: team.statuses.map((s) => s.id),
        })
      ).statusCode,
    ).toBe(403);
  });
});
