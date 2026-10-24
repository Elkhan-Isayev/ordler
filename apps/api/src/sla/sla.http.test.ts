import type {
  AdminRole,
  CalendarView,
  InviteResponse,
  RequestSummary,
  RequestTypeView,
  RequestView,
  SlaPolicyView,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { RecordingNotifier } from '../notifications/notifier.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER, testClock } from '../test/fixtures.js';
import type { WebhookFetch } from '../webhooks/webhook.service.js';

const MIN = 60_000;

let t: TestApp;
let owner: string;
let clock: ReturnType<typeof testClock>;
let notifier: RecordingNotifier;
let hooks: string[];
const ids = {} as Record<'it' | 'fin' | 'help', string>;
const people = {} as Record<'lead' | 'asker' | 'finadmin', { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PUT';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

const fakeFetch: WebhookFetch = (_url, init) => {
  hooks.push(init.headers['ordler-event']!);
  return Promise.resolve({ status: 200 });
};

beforeEach(async () => {
  // Monday 2026-10-26 09:00 UTC.
  clock = testClock(new Date('2026-10-26T09:00:00Z'));
  notifier = new RecordingNotifier();
  hooks = [];
  t = await createTestApp({ now: clock.now, notifier, webhookFetch: fakeFetch });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const dept = async (name: string) =>
    (await call('POST', '/api/admin/departments', owner, { name })).json<{ id: string }>().id;
  ids.it = await dept('IT');
  ids.fin = await dept('Finance');
  ids.help = (
    await call('POST', `/api/admin/departments/${ids.it}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
      isPrivate: false,
    })
  ).json<{ id: string }>().id;
  const person = async (
    name: keyof typeof people,
    role: string,
    scope: object,
    teamIds: string[],
  ) => {
    const invite = (
      await call('POST', '/api/admin/members', owner, {
        email: `${name}@push30.test`,
        name,
        role: { roleId: roles.find((r) => r.key === role)!.id, scope },
        teamIds,
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
  };
  await person('lead', 'team_lead', { type: 'team', id: ids.help }, [ids.help]);
  await person('asker', 'member', { type: 'department', id: ids.fin }, []);
  await person('finadmin', 'department_admin', { type: 'department', id: ids.fin }, []);
  await call('POST', `/api/admin/webhooks`, owner, {
    name: 'SLA',
    url: 'https://hooks.example.test',
    events: ['sla.at_risk', 'sla.breached'],
  });
});
afterEach(() => t.close());

/** Mon–Fri 09:00–17:00 UTC. */
async function officeHours(departmentId = ids.it, cookie = owner) {
  return call('POST', `/api/admin/departments/${departmentId}/calendars`, cookie, {
    name: 'Office',
    timezone: 'UTC',
    hours: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
  });
}

async function policy(body: object = {}) {
  const created = await call('POST', `/api/admin/departments/${ids.it}/sla-policies`, owner, {
    name: 'Standard',
    targets: { none: { firstResponseMinutes: 60, resolutionMinutes: 480 } },
    ...body,
  });
  expect(created.statusCode).toBe(201);
  return created.json<SlaPolicyView>();
}

async function requestType(slaPolicyId: string | null) {
  const created = await call('POST', `/api/admin/departments/${ids.it}/request-types`, owner, {
    name: 'Laptop',
    targetTeamId: ids.help,
    fields: [],
    slaPolicyId,
  });
  expect(created.statusCode).toBe(201);
  return created.json<RequestTypeView>();
}

async function submit(typeId: string) {
  const created = await call('POST', '/api/requests', people.asker.cookie, {
    requestTypeId: typeId,
    title: 'New laptop',
  });
  expect(created.statusCode).toBe(201);
  return created.json<RequestView>();
}

const view = async (identifier: string, cookie = people.lead.cookie) =>
  (await call('GET', `/api/requests/${identifier}`, cookie)).json<RequestView>();
const act = (identifier: string, body: object) =>
  call('POST', `/api/requests/${identifier}/actions`, people.lead.cookie, body);

describe('SLA calendars and policies (SPEC §6.5)', () => {
  it('are managed by the department’s admins only', async () => {
    expect((await officeHours(ids.it, people.lead.cookie)).statusCode).toBe(403);
    expect((await officeHours(ids.it, people.finadmin.cookie)).statusCode).toBe(403);
    expect((await officeHours(ids.fin, people.finadmin.cookie)).statusCode).toBe(201);
    expect(
      (await call('GET', `/api/admin/departments/${ids.it}/sla-policies`, people.lead.cookie))
        .statusCode,
    ).toBe(403);
  });

  it('validates calendars and keeps used calendars', async () => {
    const bad = await call('POST', `/api/admin/departments/${ids.it}/calendars`, owner, {
      name: 'Mars',
      timezone: 'Mars/Olympus',
      hours: [{ day: 1, start: '09:00', end: '08:00' }],
    });
    expect(bad.statusCode).toBe(400);
    const calendar = (await officeHours()).json<CalendarView>();
    const foreign = (await officeHours(ids.fin)).json<CalendarView>();
    expect(
      (
        await call('POST', `/api/admin/departments/${ids.it}/sla-policies`, owner, {
          name: 'X',
          calendarId: foreign.id,
          targets: {},
        })
      ).statusCode,
    ).toBe(400);
    const used = await policy({ calendarId: calendar.id });
    expect(used.calendar).toEqual({ id: calendar.id, name: 'Office' });
    expect(
      (await call('POST', `/api/admin/calendars/${calendar.id}/archive`, owner)).json(),
    ).toEqual({ error: 'calendar_in_use' });
  });

  it('only accepts the department’s own live policies on request types', async () => {
    const own = await policy();
    const type = await requestType(own.id);
    expect(type.slaPolicy).toEqual({ id: own.id, name: 'Standard' });
    await call('POST', `/api/admin/sla-policies/${own.id}/archive`, owner);
    const types = (await call('GET', `/api/admin/departments/${ids.it}/request-types`, owner)).json<
      RequestTypeView[]
    >();
    // Archiving takes the policy off types: new requests no longer get it.
    expect(types[0]!.slaPolicy).toBeNull();
    const reuse = await call('PUT', `/api/admin/request-types/${type.id}`, owner, {
      name: 'Laptop',
      targetTeamId: ids.help,
      slaPolicyId: own.id,
    });
    expect(reuse.statusCode).toBe(400);
  });
});

describe('SLA clocks on requests', () => {
  it('shows both clocks to agent and requester, and badges in the queue', async () => {
    const type = await requestType((await policy()).id);
    const request = await submit(type.id);
    clock.advance(30 * MIN);
    const agent = await view(request.identifier);
    expect(agent.slaClocks).toMatchObject({
      policy: { name: 'Standard' },
      firstResponse: { state: 'on_track', elapsedMinutes: 30, dueAt: '2026-10-26T10:00:00.000Z' },
      resolution: { state: 'on_track', targetMinutes: 480 },
    });
    expect((await view(request.identifier, people.asker.cookie)).slaClocks).not.toBeNull();
    const queue = (await call('GET', '/api/teams/HELP/requests', people.lead.cookie)).json<
      RequestSummary[]
    >();
    expect(queue[0]!.sla).toEqual({
      metric: 'firstResponse',
      state: 'on_track',
      dueAt: '2026-10-26T10:00:00.000Z',
    });
  });

  it('stops at the first team reply, pauses while waiting and stops on resolution', async () => {
    const type = await requestType((await policy()).id);
    const request = await submit(type.id);
    clock.advance(10 * MIN);
    // A reply from the requester does not count as a response.
    await call('POST', `/api/requests/${request.identifier}/comments`, people.asker.cookie, {
      body: 'Any news?',
    });
    clock.advance(10 * MIN);
    await act(request.identifier, { action: 'accept' });
    let sla = (await view(request.identifier)).slaClocks!;
    expect(sla.firstResponse).toMatchObject({ state: 'met', elapsedMinutes: 20 });

    clock.advance(40 * MIN);
    await act(request.identifier, { action: 'wait_for_requester', comment: 'Which model?' });
    clock.advance(5 * 60 * MIN);
    sla = (await view(request.identifier)).slaClocks!;
    expect(sla.resolution).toMatchObject({ state: 'paused', elapsedMinutes: 60, dueAt: null });

    await call('POST', `/api/requests/${request.identifier}/comments`, people.asker.cookie, {
      body: 'The 14-inch one',
    });
    clock.advance(30 * MIN);
    await act(request.identifier, { action: 'resolve' });
    sla = (await view(request.identifier)).slaClocks!;
    expect(sla.resolution).toMatchObject({ state: 'met', elapsedMinutes: 90 });
  });

  it('follows the priority and the business calendar', async () => {
    const calendar = (await officeHours()).json<CalendarView>();
    const type = await requestType(
      (
        await policy({
          calendarId: calendar.id,
          targets: {
            none: { firstResponseMinutes: 60, resolutionMinutes: null },
            urgent: { firstResponseMinutes: 15, resolutionMinutes: null },
          },
        })
      ).id,
    );
    clock.advance(7.5 * 60 * MIN); // 16:30
    const request = await submit(type.id);
    const before = (await view(request.identifier)).slaClocks!;
    expect(before.firstResponse!.dueAt).toBe('2026-10-27T09:30:00.000Z');
    expect(before.resolution).toBeNull();
    await act(request.identifier, { action: 'priority', priority: 'urgent' });
    expect((await view(request.identifier)).slaClocks!.firstResponse!.dueAt).toBe(
      '2026-10-26T16:45:00.000Z',
    );
  });

  it('alerts once when at risk and once when breached', async () => {
    const type = await requestType((await policy()).id);
    const request = await submit(type.id);
    await act(request.identifier, { action: 'assign', assigneeId: people.lead.id });
    notifier.sent.length = 0;

    clock.advance(40 * MIN);
    expect(await t.ctx.sla.tick()).toBe(0);
    clock.advance(6 * MIN); // 46 min: past 75 % of an hour
    expect(await t.ctx.sla.tick()).toBe(1);
    expect(await t.ctx.sla.tick()).toBe(0);
    clock.advance(20 * MIN);
    expect(await t.ctx.sla.tick()).toBe(1);
    expect(notifier.sent.map((n) => [n.kind, n.recipients, n.data?.metric])).toEqual([
      ['sla_at_risk', [people.lead.id], 'firstResponse'],
      ['sla_breached', [people.lead.id], 'firstResponse'],
    ]);
    await t.ctx.webhooks.tick();
    expect(hooks).toEqual(['sla.at_risk', 'sla.breached']);
    expect((await view(request.identifier)).slaClocks!.firstResponse!.state).toBe('breached');
  });

  it('leaves requests of types without SLA alone', async () => {
    const type = await requestType(null);
    const request = await submit(type.id);
    expect((await view(request.identifier)).slaClocks).toBeNull();
    clock.advance(10 * 24 * 60 * MIN);
    expect(await t.ctx.sla.tick()).toBe(0);
  });
});
