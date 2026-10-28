import type {
  AdminRole,
  CalendarView,
  DelegationView,
  InviteResponse,
  PendingApproval,
  RequestTypeView,
  RequestView,
  SlaPolicyView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { approvalDecisions } from '../db/schema.js';
import { RecordingNotifier } from '../notifications/notifier.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER, testClock } from '../test/fixtures.js';

const HOUR = 3_600_000;

let t: TestApp;
let owner: string;
let clock: ReturnType<typeof testClock>;
let notifier: RecordingNotifier;
let roles: AdminRole[];
const ids = {} as Record<'it' | 'fin' | 'help', string>;
type Person = 'asker' | 'boss' | 'boss2' | 'stand' | 'itadmin' | 'backup';
const people = {} as Record<Person, { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'DELETE';
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
  // Monday 2026-11-02 09:00 UTC.
  clock = testClock(new Date('2026-11-02T09:00:00Z'));
  notifier = new RecordingNotifier();
  t = await createTestApp({ now: clock.now, notifier });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
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
  await person('asker', 'member', ids.fin);
  await person('boss', 'member', ids.fin);
  await person('boss2', 'member', ids.fin);
  await person('stand', 'member', ids.fin);
  await person('itadmin', 'department_admin', ids.it);
  await person('backup', 'member', ids.it);
});
afterEach(() => t.close());

const user = (name: Person) => ({ type: 'user', memberId: people[name].id });

async function requestType(steps: object[], extra: object = {}) {
  const created = await call('POST', `/api/admin/departments/${ids.it}/request-types`, owner, {
    name: 'Access',
    targetTeamId: ids.help,
    fields: [],
    approvalSteps: steps,
    ...extra,
  });
  expect(created.statusCode).toBe(201);
  return created.json<RequestTypeView>();
}

async function submit(typeId: string, extra: object = {}) {
  const created = await call('POST', '/api/requests', people.asker.cookie, {
    requestTypeId: typeId,
    title: 'VPN',
    ...extra,
  });
  expect(created.statusCode).toBe(201);
  return created.json<RequestView>();
}

const view = async (identifier: string, cookie = owner) =>
  (await call('GET', `/api/requests/${identifier}`, cookie)).json<RequestView>();
const decide = (cookie: string, stepId: string, decision = 'approve') =>
  call('POST', `/api/approvals/${stepId}/decision`, cookie, { decision });
const delegate = (cookie: string, body: object) =>
  call('POST', '/api/me/delegations', cookie, body);

describe('out-of-office delegation (SPEC §6.3)', () => {
  it('is managed by each member for themselves', async () => {
    expect(
      (
        await delegate(people.boss.cookie, {
          delegateId: people.boss.id,
          startsOn: '2026-11-02',
          endsOn: '2026-11-06',
        })
      ).statusCode,
    ).toBe(400);
    const created = await delegate(people.boss.cookie, {
      delegateId: people.stand.id,
      startsOn: '2026-11-02',
      endsOn: '2026-11-06',
    });
    expect(created.statusCode).toBe(201);
    const [entry] = created.json<DelegationView[]>();
    expect(entry).toMatchObject({ delegate: { name: 'stand' }, active: true });
    const overlap = await delegate(people.boss.cookie, {
      delegateId: people.boss2.id,
      startsOn: '2026-11-05',
      endsOn: '2026-11-09',
    });
    expect(overlap.json()).toEqual({ error: 'delegation_overlap' });
    // Someone else cannot remove it.
    expect(
      (await call('DELETE', `/api/me/delegations/${entry!.id}`, people.stand.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call('DELETE', `/api/me/delegations/${entry!.id}`, people.boss.cookie)).statusCode,
    ).toBe(204);
    expect((await call('GET', '/api/me/delegations', people.boss.cookie)).json()).toEqual([]);
  });

  it('lets the delegate decide for the absent approver, recorded for both', async () => {
    await delegate(people.boss.cookie, {
      delegateId: people.stand.id,
      startsOn: '2026-11-02',
      endsOn: '2026-11-06',
    });
    const type = await requestType([{ selector: user('boss') }]);
    const request = await submit(type.id);
    const step = request.approvals[0]!;
    // The stand-in hears about it too.
    expect(notifier.sent.find((n) => n.kind === 'approval_requested')!.recipients).toEqual([
      people.boss.id,
      people.stand.id,
    ]);
    const pending = (await call('GET', '/api/me/approvals', people.stand.cookie)).json<
      PendingApproval[]
    >();
    expect(pending).toMatchObject([{ stepId: step.id, onBehalfOf: { id: people.boss.id } }]);
    const seen = await view(request.identifier, people.stand.cookie);
    expect(seen.approvals[0]).toMatchObject({ canDecide: true, decidesFor: { name: 'boss' } });

    expect((await decide(people.stand.cookie, step.id)).statusCode).toBe(200);
    const after = await view(request.identifier);
    expect(after.status).toBe('open');
    expect(after.approvals[0]!.decisions[0]).toMatchObject({
      approver: { id: people.stand.id },
      onBehalfOf: { id: people.boss.id },
    });
    const [row] = await t.ctx.db
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.stepId, step.id));
    expect(row).toMatchObject({ approverId: people.stand.id, onBehalfOfId: people.boss.id });
  });

  it('counts a delegated decision for the absent approver under the “all” rule', async () => {
    await delegate(people.boss.cookie, {
      delegateId: people.stand.id,
      startsOn: '2026-11-02',
      endsOn: '2026-11-02',
    });
    const type = await requestType([
      {
        selector: {
          type: 'role',
          roleId: roles.find((r) => r.key === 'member')!.id,
          departmentId: ids.fin,
        },
        rule: 'all',
      },
    ]);
    const request = await submit(type.id);
    const step = request.approvals[0]!;
    // stand approves twice: as themselves and for boss; the second stand-in click is refused.
    expect((await decide(people.stand.cookie, step.id)).statusCode).toBe(200);
    expect((await decide(people.stand.cookie, step.id)).statusCode).toBe(200);
    expect((await decide(people.stand.cookie, step.id)).json()).toEqual({
      error: 'already_decided',
    });
    expect((await decide(people.boss.cookie, step.id)).json()).toEqual({
      error: 'already_decided',
    });
    await decide(people.boss2.cookie, step.id);
    expect((await view(request.identifier)).status).toBe('open');
  });

  it('gives nothing outside the date range', async () => {
    await delegate(people.boss.cookie, {
      delegateId: people.stand.id,
      startsOn: '2026-11-10',
      endsOn: '2026-11-12',
    });
    const type = await requestType([{ selector: user('boss') }]);
    const request = await submit(type.id);
    expect((await call('GET', '/api/me/approvals', people.stand.cookie)).json()).toEqual([]);
    expect((await decide(people.stand.cookie, request.approvals[0]!.id)).statusCode).toBe(404);
  });

  it('never lets the requester decide through a delegation', async () => {
    await delegate(people.boss.cookie, {
      delegateId: people.asker.id,
      startsOn: '2026-11-02',
      endsOn: '2026-11-06',
    });
    const type = await requestType([{ selector: user('boss') }]);
    const request = await submit(type.id);
    expect((await decide(people.asker.cookie, request.approvals[0]!.id)).json()).toEqual({
      error: 'not_an_approver',
    });
  });
});

describe('approval timeouts (SPEC §6.3)', () => {
  it('reminds the approvers once when the time is up', async () => {
    const type = await requestType([
      { selector: user('boss'), timeout: { hours: 4, action: 'remind' } },
    ]);
    await submit(type.id);
    notifier.sent.length = 0;
    clock.advance(3 * HOUR);
    expect(await t.ctx.requests.tickApprovalTimeouts()).toBe(0);
    clock.advance(HOUR);
    expect(await t.ctx.requests.tickApprovalTimeouts()).toBe(1);
    expect(await t.ctx.requests.tickApprovalTimeouts()).toBe(0);
    expect(notifier.sent.map((n) => [n.kind, n.recipients])).toEqual([
      ['approval_reminder', [people.boss.id]],
    ]);
  });

  it('reminds halfway, then escalates to the fallback approvers', async () => {
    const type = await requestType([
      {
        selector: user('boss'),
        timeout: { hours: 8, action: 'escalate' },
        fallbackSelector: user('backup'),
      },
    ]);
    const request = await submit(type.id);
    notifier.sent.length = 0;
    clock.advance(4 * HOUR);
    await t.ctx.requests.tickApprovalTimeouts();
    clock.advance(4 * HOUR);
    await t.ctx.requests.tickApprovalTimeouts();
    expect(notifier.sent.map((n) => [n.kind, n.recipients])).toEqual([
      ['approval_reminder', [people.boss.id]],
      ['approval_requested', [people.backup.id]],
    ]);
    const after = await view(request.identifier);
    expect(after.approvals[0]).toMatchObject({
      status: 'active',
      escalatedAt: clock.now().toISOString(),
    });
    expect(after.approvals[0]!.approvers.map((a) => a.name).sort()).toEqual(['backup', 'boss']);
    expect(after.events.at(-1)!.kind).toBe('approval_escalated');
    // Both the original and the fallback approver may now decide.
    expect((await decide(people.backup.cookie, request.approvals[0]!.id)).statusCode).toBe(200);
    expect(await t.ctx.requests.tickApprovalTimeouts()).toBe(0);
  });

  it('escalates to the approving department’s admins without a fallback', async () => {
    const type = await requestType([
      {
        selector: { type: 'department_head', departmentId: ids.it },
        timeout: { hours: 1, action: 'escalate' },
      },
    ]);
    const request = await submit(type.id);
    clock.advance(HOUR);
    await t.ctx.requests.tickApprovalTimeouts();
    const names = (await view(request.identifier)).approvals[0]!.approvers.map((a) => a.name);
    expect(names).toContain('itadmin');
  });

  it('rejects without writing a decision when told to', async () => {
    const type = await requestType([
      { selector: user('boss'), timeout: { hours: 2, action: 'reject' } },
    ]);
    const request = await submit(type.id);
    notifier.sent.length = 0;
    clock.advance(2 * HOUR);
    await t.ctx.requests.tickApprovalTimeouts();
    const after = await view(request.identifier);
    expect(after.status).toBe('rejected');
    expect(after.approvals[0]!.status).toBe('rejected');
    expect(after.events.map((e) => e.kind)).toContain('approval_timed_out');
    expect(notifier.sent.find((n) => n.kind === 'request_rejected')).toMatchObject({
      recipients: [people.asker.id],
      data: { reason: 'timeout' },
    });
    const decisions = await t.ctx.db
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.stepId, request.approvals[0]!.id));
    expect(decisions).toEqual([]);
  });

  it('counts business hours of the type’s SLA calendar', async () => {
    const calendar = (
      await call('POST', `/api/admin/departments/${ids.it}/calendars`, owner, {
        name: 'Office',
        timezone: 'UTC',
        hours: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
      })
    ).json<CalendarView>();
    const policy = (
      await call('POST', `/api/admin/departments/${ids.it}/sla-policies`, owner, {
        name: 'Office SLA',
        calendarId: calendar.id,
        targets: {},
      })
    ).json<SlaPolicyView>();
    const type = await requestType(
      [{ selector: user('boss'), timeout: { hours: 8, action: 'reject' } }],
      {
        slaPolicyId: policy.id,
      },
    );
    clock.advance(4 * 24 * HOUR + 4 * HOUR); // Friday 13:00
    const request = await submit(type.id);
    clock.advance(3 * 24 * HOUR); // Monday 13:00: only 4 + 4 business hours passed
    await t.ctx.requests.tickApprovalTimeouts();
    expect((await view(request.identifier)).status).toBe('rejected');

    const late = await submit(type.id); // Monday 13:00
    clock.advance(23 * HOUR); // Tuesday 12:00: 4 + 3 business hours, one short
    await t.ctx.requests.tickApprovalTimeouts();
    expect((await view(late.identifier)).status).toBe('pending_approval');
  });

  it('never applies to steps the requester added', async () => {
    const type = await requestType([], { allowRequesterApprovals: true });
    const request = await submit(type.id, {
      extraApprovals: [{ selector: user('boss'), timeout: { hours: 1, action: 'reject' } }],
    });
    expect(request.approvals[0]!.timeout).toBeNull();
    clock.advance(10 * HOUR);
    expect(await t.ctx.requests.tickApprovalTimeouts()).toBe(0);
  });
});
