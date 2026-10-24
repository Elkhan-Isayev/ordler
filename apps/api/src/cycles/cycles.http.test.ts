import type {
  AdminRole,
  CycleDetail,
  InviteResponse,
  IssueDetail,
  TeamCycles,
  TeamView,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let dev: string;
let clock: Date;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

const SETTINGS = { enabled: true, weeks: 2, startDay: 1, cooldownWeeks: 0, upcoming: 2 };
const cyclesOf = async () =>
  (await call('GET', '/api/teams/HELP/cycles', owner)).json<TeamCycles>();
const team = async () => (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();

beforeEach(async () => {
  // Thursday.
  clock = new Date('2026-10-22T10:00:00Z');
  t = await createTestApp({ now: () => clock });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const dept = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>();
  const help = (
    await call('POST', `/api/admin/departments/${dept.id}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
    })
  ).json<{ id: string }>();
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: 'dev@push30.test',
      name: 'dev',
      role: {
        roleId: roles.find((r) => r.key === 'member')!.id,
        scope: { type: 'team', id: help.id },
      },
      teamIds: [help.id],
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

describe('cycles (SPEC §5.2)', () => {
  it('are off until a team manager plans them', async () => {
    expect(await cyclesOf()).toMatchObject({ settings: { enabled: false }, cycles: [] });
    expect((await call('PUT', '/api/teams/HELP/cycle-settings', dev, SETTINGS)).statusCode).toBe(
      403,
    );

    const planned = (
      await call('PUT', '/api/teams/HELP/cycle-settings', owner, SETTINGS)
    ).json<TeamCycles>();
    expect(planned.cycles.map((c) => [c.number, c.startsOn, c.endsOn, c.state])).toEqual([
      [1, '2026-10-19', '2026-11-01', 'current'],
      [2, '2026-11-02', '2026-11-15', 'upcoming'],
      [3, '2026-11-16', '2026-11-29', 'upcoming'],
    ]);
    // Planning is idempotent.
    expect((await cyclesOf()).cycles).toHaveLength(3);
    expect((await team()).cycles.map((c) => c.number)).toEqual([1, 2, 3]);
  });

  it('rolls unfinished issues over to the next cycle and keeps a burn-up', async () => {
    const { cycles } = (
      await call('PUT', '/api/teams/HELP/cycle-settings', owner, SETTINGS)
    ).json<TeamCycles>();
    const [current, next] = cycles;
    const done = (await team()).statuses.find((s) => s.key === 'done')!.id;

    const a = (
      await call('POST', '/api/teams/HELP/issues', owner, {
        title: 'Ship it',
        cycleId: current!.id,
      })
    ).json<IssueDetail>();
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Later', cycleId: current!.id });
    clock = new Date('2026-10-23T10:00:00Z');
    await call('PATCH', `/api/issues/${a.identifier}`, owner, { statusId: done });
    // Added mid-cycle: a scope change.
    const c = (
      await call('POST', '/api/teams/HELP/issues', owner, { title: 'Urgent extra' })
    ).json<IssueDetail>();
    await call('PATCH', `/api/issues/${c.identifier}`, owner, { cycleId: current!.id });

    clock = new Date('2026-11-03T08:00:00Z');
    const after = await cyclesOf();
    expect(after.cycles.map((x) => [x.number, x.state])).toEqual([
      [1, 'past'],
      [2, 'current'],
      [3, 'upcoming'],
      [4, 'upcoming'],
    ]);
    const issues = (await call('GET', '/api/teams/HELP/issues', owner)).json<
      Array<{ title: string; cycleId: string }>
    >();
    expect(Object.fromEntries(issues.map((i) => [i.title, i.cycleId]))).toEqual({
      'Ship it': current!.id,
      Later: next!.id,
      'Urgent extra': next!.id,
    });
    const later = (await call('GET', '/api/issues/HELP-2', owner)).json<IssueDetail>();
    expect(later.events.at(-1)).toMatchObject({
      actor: null,
      changes: { cycleId: { from: current!.id, to: next!.id } },
    });

    const detail = (await call('GET', `/api/cycles/${current!.id}`, owner)).json<CycleDetail>();
    expect(detail).toMatchObject({
      state: 'past',
      addedAfterStart: 3,
      progress: { total: 1, completed: 1 },
    });
    expect(detail.burnup.slice(2, 6)).toEqual([
      { date: '2026-10-21', scope: 0, completed: 0 },
      { date: '2026-10-22', scope: 2, completed: 0 },
      { date: '2026-10-23', scope: 3, completed: 1 },
      { date: '2026-10-24', scope: 3, completed: 1 },
    ]);
    expect(detail.burnup.at(-1)).toEqual({ date: '2026-11-01', scope: 3, completed: 1 });

    // A finished cycle no longer takes issues.
    expect(
      (
        await call('POST', '/api/teams/HELP/issues', owner, {
          title: 'Too late',
          cycleId: current!.id,
        })
      ).json(),
    ).toEqual({ error: 'cycle_not_in_team' });
  });

  it('names cycles and hides other teams’ cycles', async () => {
    const { cycles } = (
      await call('PUT', '/api/teams/HELP/cycle-settings', owner, SETTINGS)
    ).json<TeamCycles>();
    const renamed = await call('PATCH', `/api/cycles/${cycles[0]!.id}`, owner, {
      name: 'Launch sprint',
    });
    expect(renamed.json()).toMatchObject({ name: 'Launch sprint' });
    expect(
      (await call('PATCH', `/api/cycles/${cycles[0]!.id}`, dev, { name: 'x' })).statusCode,
    ).toBe(403);
    expect(
      (await call('GET', '/api/cycles/00000000-0000-7000-8000-000000000000', owner)).statusCode,
    ).toBe(404);
  });
});
