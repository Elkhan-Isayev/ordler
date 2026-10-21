import type {
  AdminRole,
  InviteResponse,
  PendingApproval,
  RequestGroupView,
  RequestSummary,
  RequestTypeView,
  RequestView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../db/schema.js';
import { RecordingNotifier } from '../notifications/notifier.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let notifier: RecordingNotifier;
let owner: string;
let roles: AdminRole[];
const ids = {} as Record<'it' | 'finance' | 'cs' | 'help' | 'acc' | 'cs1', string>;
const people: Record<string, { cookie: string; id: string }> = {};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

const role = (key: string) => roles.find((r) => r.key === key)!.id;

/** A member with one role at a scope, optionally in some teams. */
async function person(name: string, grant: { role: string; scope: object }, teams: string[] = []) {
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name}@push30.test`,
      name,
      role: { roleId: role(grant.role), scope: grant.scope },
      teamIds: teams,
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
  return people[name];
}

async function grant(name: string, roleKey: string, scope: object) {
  await call('POST', `/api/admin/members/${people[name]!.id}/roles`, owner, {
    roleId: role(roleKey),
    scope,
  });
}

async function department(name: string) {
  return (await call('POST', '/api/admin/departments', owner, { name })).json<{ id: string }>().id;
}
async function team(departmentId: string, name: string, key: string) {
  return (
    await call('POST', `/api/admin/departments/${departmentId}/teams`, owner, { name, key })
  ).json<{
    id: string;
  }>().id;
}
async function requestType(departmentId: string, body: object) {
  const created = await call(
    'POST',
    `/api/admin/departments/${departmentId}/request-types`,
    owner,
    body,
  );
  expect(created.statusCode).toBe(201);
  return created.json<RequestTypeView>();
}

const dept = (id: string) => ({ type: 'department', id });
const teamScope = (id: string) => ({ type: 'team', id });

beforeEach(async () => {
  notifier = new RecordingNotifier();
  t = await createTestApp({ notifier });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();

  ids.it = await department('IT');
  ids.finance = await department('Finance');
  ids.cs = await department('Customer Support');
  ids.help = await team(ids.it, 'Helpdesk', 'HELP');
  ids.acc = await team(ids.finance, 'Accounting', 'ACC');
  ids.cs1 = await team(ids.cs, 'Tier 1', 'CS1');

  await person('agent', { role: 'member', scope: teamScope(ids.cs1) }, [ids.cs1]);
  await person('csboss', { role: 'department_supervisor', scope: dept(ids.cs) }, [ids.cs1]);
  await grant('csboss', 'member', teamScope(ids.cs1));
  await person('finboss', { role: 'department_supervisor', scope: dept(ids.finance) }, [ids.acc]);
  await person('itlead', { role: 'team_lead', scope: teamScope(ids.help) }, [ids.help]);
  await person('itmember', { role: 'member', scope: teamScope(ids.help) }, [ids.help]);
  await person('accountant', { role: 'team_lead', scope: teamScope(ids.acc) }, [ids.acc]);
  notifier.sent.length = 0;
});
afterEach(() => t.close());

async function hardwareType(extra: object = {}) {
  return requestType(ids.it, {
    name: 'Hardware purchase',
    targetTeamId: ids.help,
    fields: [
      { id: 'item', label: 'Item', type: 'select', required: true, options: ['Headset', 'Laptop'] },
      { id: 'quantity', label: 'Quantity', type: 'number', required: true },
    ],
    approvalSteps: [{ selector: { type: 'requester_department_supervisor' } }],
    allowRequesterApprovals: true,
    ...extra,
  });
}

const financeApproval = () => ({
  selector: { type: 'role', roleId: role('department_supervisor'), departmentId: ids.finance },
});

async function submitHeadsets(typeId: string, extraApprovals = [financeApproval()]) {
  const submitted = await call('POST', '/api/requests', people.agent!.cookie, {
    requestTypeId: typeId,
    title: '20 headsets for CS',
    formData: { item: 'Headset', quantity: 20 },
    extraApprovals,
  });
  expect(submitted.statusCode).toBe(201);
  return submitted.json<RequestView>();
}

const stepOf = (view: RequestView, index: number) => view.approvals[index]!;
const decide = (cookie: string, stepId: string, body: object) =>
  call('POST', `/api/approvals/${stepId}/decision`, cookie, body);
const queue = async (key: string, cookie: string) =>
  (await call('GET', `/api/teams/${key}/requests`, cookie)).json<RequestSummary[]>();

describe('approvals (MVP criteria 2, 3, 4, 5)', () => {
  it('CS supervisor, then Finance supervisor, then IT triage', async () => {
    const type = await hardwareType();
    const request = await submitHeadsets(type.id);
    expect(request).toMatchObject({ identifier: 'REQ-1', status: 'pending_approval' });
    expect(request.approvals.map((s) => [s.origin, s.status])).toEqual([
      ['mandatory', 'active'],
      ['requester_added', 'waiting'],
    ]);
    expect(stepOf(request, 0).approvers.map((a) => a.name)).toEqual(['csboss']);
    expect(notifier.sent.at(-1)).toMatchObject({
      kind: 'approval_requested',
      recipients: [people.csboss!.id],
    });
    // Not visible to IT while approvals are pending.
    expect(await queue('HELP', people.itlead!.cookie)).toEqual([]);

    const pending = (await call('GET', '/api/me/approvals', people.csboss!.cookie)).json<
      PendingApproval[]
    >();
    expect(pending).toMatchObject([{ request: { identifier: 'REQ-1' } }]);

    const afterCs = (
      await decide(people.csboss!.cookie, stepOf(request, 0).id, { decision: 'approve' })
    ).json<{
      request: RequestView;
    }>().request;
    expect(afterCs.approvals.map((s) => s.status)).toEqual(['approved', 'active']);
    expect(stepOf(afterCs, 1).approvers.map((a) => a.name)).toEqual(['finboss']);
    expect((await call('GET', '/api/me/approvals', people.csboss!.cookie)).json()).toEqual([]);

    const afterFinance = (
      await decide(people.finboss!.cookie, stepOf(request, 1).id, { decision: 'approve' })
    ).json<{ request: RequestView }>().request;
    expect(afterFinance.status).toBe('open');
    expect((await queue('HELP', people.itlead!.cookie)).map((r) => r.identifier)).toEqual([
      'REQ-1',
    ]);
    expect(
      notifier.sent.some(
        (n) => n.kind === 'request_received' && n.recipients.includes(people.itlead!.id),
      ),
    ).toBe(true);
  });

  it('a Finance rejection closes the request with the reason visible to the requester', async () => {
    const request = await submitHeadsets((await hardwareType()).id);
    await decide(people.csboss!.cookie, stepOf(request, 0).id, { decision: 'approve' });
    expect(
      (await decide(people.finboss!.cookie, stepOf(request, 1).id, { decision: 'reject' }))
        .statusCode,
    ).toBe(400);
    await decide(people.finboss!.cookie, stepOf(request, 1).id, {
      decision: 'reject',
      comment: 'Over budget',
    });

    const seen = (
      await call('GET', '/api/requests/REQ-1', people.agent!.cookie)
    ).json<RequestView>();
    expect(seen.status).toBe('rejected');
    expect(stepOf(seen, 1).decisions).toMatchObject([
      { decision: 'reject', comment: 'Over budget' },
    ]);
    expect(notifier.sent.at(-1)).toMatchObject({
      kind: 'request_rejected',
      recipients: [people.agent!.id],
    });
    expect(await queue('HELP', people.itlead!.cookie)).toEqual([]);
  });

  it('the requester never approves their own request, even as supervisor', async () => {
    const type = await hardwareType();
    // csboss is the supervisor of their own department.
    const submitted = (
      await call('POST', '/api/requests', people.csboss!.cookie, {
        requestTypeId: type.id,
        title: 'My headset',
        formData: { item: 'Headset', quantity: 1 },
      })
    ).json<RequestView>();
    const step = stepOf(submitted, 0);
    expect(step.approvers.map((a) => a.id)).not.toContain(people.csboss!.id);
    expect(step.canDecide).toBe(false);
    expect((await decide(people.csboss!.cookie, step.id, { decision: 'approve' })).json()).toEqual({
      error: 'not_an_approver',
    });
    // With no other supervisor, the organization's Owner decides.
    expect(step.approvers.map((a) => a.name)).toEqual(['Owner']);
  });

  it('only resolved approvers decide, each once', async () => {
    const request = await submitHeadsets((await hardwareType()).id);
    const step = stepOf(request, 0);
    // Finance is not involved yet, so the request stays hidden from them.
    expect(
      (await decide(people.finboss!.cookie, step.id, { decision: 'approve' })).statusCode,
    ).toBe(404);
    // The receiving team sees the request but is not an approver.
    expect((await decide(people.itlead!.cookie, step.id, { decision: 'approve' })).json()).toEqual({
      error: 'not_an_approver',
    });
    // A waiting step has no approvers yet.
    expect(
      (await decide(people.finboss!.cookie, stepOf(request, 1).id, { decision: 'approve' }))
        .statusCode,
    ).toBe(404);
    await decide(people.csboss!.cookie, step.id, { decision: 'approve' });
    // A decided step cannot be decided again.
    expect(
      (await decide(people.csboss!.cookie, step.id, { decision: 'reject', comment: 'x' })).json(),
    ).toEqual({
      error: 'step_not_active',
    });
  });

  it('supports user and department head selectors and the "all" rule', async () => {
    await person('finboss2', { role: 'department_supervisor', scope: dept(ids.finance) });
    await call('PATCH', `/api/admin/departments/${ids.it}`, owner, {
      headMemberId: people.itlead!.id,
    });
    const type = await hardwareType({
      approvalSteps: [
        { selector: { type: 'user', memberId: people.accountant!.id } },
        { selector: { type: 'department_head', departmentId: ids.it } },
        {
          selector: {
            type: 'role',
            roleId: role('department_supervisor'),
            departmentId: ids.finance,
          },
          rule: 'all',
        },
      ],
    });
    const request = await submitHeadsets(type.id, []);
    expect(stepOf(request, 0).approvers.map((a) => a.name)).toEqual(['accountant']);
    await decide(people.accountant!.cookie, stepOf(request, 0).id, { decision: 'approve' });
    let seen = (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>();
    expect(stepOf(seen, 1).approvers.map((a) => a.name)).toEqual(['itlead']);
    await decide(people.itlead!.cookie, stepOf(request, 1).id, { decision: 'approve' });

    const all = stepOf(request, 2).id;
    await decide(people.finboss!.cookie, all, { decision: 'approve' });
    seen = (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>();
    // "all": one approval of two is not enough.
    expect(stepOf(seen, 2).status).toBe('active');
    expect((await decide(people.finboss!.cookie, all, { decision: 'approve' })).json()).toEqual({
      error: 'already_decided',
    });
    await decide(people.finboss2!.cookie, all, { decision: 'approve' });
    seen = (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>();
    expect(seen.status).toBe('open');
  });

  it('records every decision in the append-only audit log with the snapshot hash', async () => {
    const request = await submitHeadsets((await hardwareType()).id);
    await decide(people.csboss!.cookie, stepOf(request, 0).id, { decision: 'approve' });
    const entries = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'approval.decided'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: people.csboss!.id, targetType: 'request' });
    expect((entries[0]!.after as { snapshotSha256: string }).snapshotSha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('cannot be decided with a personal token', async () => {
    const request = await submitHeadsets((await hardwareType()).id);
    await expect(
      t.ctx.requests.decide(
        { memberId: people.csboss!.id, tokenName: 'agent' },
        stepOf(request, 0).id,
        {
          decision: 'approve',
        },
      ),
    ).rejects.toMatchObject({ code: 'session_required' });
  });

  it('changes requested go back to the requester and restart the step', async () => {
    const request = await submitHeadsets((await hardwareType()).id, []);
    const step = stepOf(request, 0);
    await decide(people.csboss!.cookie, step.id, {
      decision: 'request_changes',
      comment: 'Only 10',
    });
    let seen = (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>();
    expect(seen).toMatchObject({ status: 'changes_requested', can: { resubmit: true } });

    seen = (
      await call('POST', '/api/requests/REQ-1/resubmit', people.agent!.cookie, {
        formData: { item: 'Headset', quantity: 10 },
      })
    ).json<RequestView>();
    expect(seen.status).toBe('pending_approval');
    expect(stepOf(seen, 0)).toMatchObject({ status: 'active' });
    expect(seen.formData.quantity).toBe(10);
    await decide(people.csboss!.cookie, step.id, { decision: 'approve' });
    expect(
      (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>().status,
    ).toBe('open');
  });

  it('validates forms and requester-added approvals', async () => {
    const type = await hardwareType({ allowRequesterApprovals: false });
    const bad = await call('POST', '/api/requests', people.agent!.cookie, {
      requestTypeId: type.id,
      title: 'x',
      formData: { item: 'Yacht' },
    });
    expect(bad.json()).toEqual({ error: 'form_invalid' });
    const extra = await call('POST', '/api/requests', people.agent!.cookie, {
      requestTypeId: type.id,
      title: 'x',
      formData: { item: 'Laptop', quantity: 1 },
      extraApprovals: [financeApproval()],
    });
    expect(extra.json()).toEqual({ error: 'approvals_not_allowed' });
  });
});

describe('receiving team (MVP criteria 6)', () => {
  async function openRequest() {
    const type = await requestType(ids.it, { name: 'VPN access', targetTeamId: ids.help });
    const request = (
      await call('POST', '/api/requests', people.agent!.cookie, {
        requestTypeId: type.id,
        title: 'VPN for Ann',
      })
    ).json<RequestView>();
    expect(request.status).toBe('open');
    return request;
  }

  it('never shows internal comments to the requester', async () => {
    await openRequest();
    await call('POST', '/api/requests/REQ-1/comments', people.itlead!.cookie, {
      body: 'Ask Bob, he broke it',
      internal: true,
    });
    await call('POST', '/api/requests/REQ-1/comments', people.itlead!.cookie, {
      body: 'Working on it',
    });
    const asRequester = (
      await call('GET', '/api/requests/REQ-1', people.agent!.cookie)
    ).json<RequestView>();
    expect(asRequester.perspective).toBe('requester');
    expect(asRequester.comments.map((c) => c.body)).toEqual(['Working on it']);
    expect(JSON.stringify(asRequester)).not.toContain('Ask Bob');
    const asTeam = (
      await call('GET', '/api/requests/REQ-1', people.itmember!.cookie)
    ).json<RequestView>();
    expect(asTeam.comments.map((c) => c.body)).toEqual(['Ask Bob, he broke it', 'Working on it']);
    // Requesters and plain members cannot write internal comments.
    expect(
      (
        await call('POST', '/api/requests/REQ-1/comments', people.agent!.cookie, {
          body: 'x',
          internal: true,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', '/api/requests/REQ-1/comments', people.itmember!.cookie, {
          body: 'x',
          internal: true,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('runs the lifecycle: accept, ask, reply, resolve, confirm', async () => {
    await openRequest();
    const act = (cookie: string, body: object) =>
      call('POST', '/api/requests/REQ-1/actions', cookie, body);
    expect((await act(people.itmember!.cookie, { action: 'accept' })).statusCode).toBe(403);
    expect((await act(people.itlead!.cookie, { action: 'resolve' })).json()).toEqual({
      error: 'invalid_transition',
    });

    await act(people.itlead!.cookie, { action: 'accept', assigneeId: people.itmember!.id });
    await act(people.itlead!.cookie, { action: 'wait_for_requester', comment: 'Which laptop?' });
    let seen = (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>();
    expect(seen.status).toBe('waiting_for_requester');
    await call('POST', '/api/requests/REQ-1/comments', people.agent!.cookie, { body: 'The Dell' });
    seen = (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>();
    expect(seen.status).toBe('in_progress');

    await act(people.itlead!.cookie, { action: 'resolve', comment: 'Done' });
    seen = (await call('GET', '/api/requests/REQ-1', people.agent!.cookie)).json<RequestView>();
    expect(seen).toMatchObject({ status: 'resolved', can: { confirm: true } });
    expect(
      (
        await call('POST', '/api/requests/REQ-1/requester-actions', people.itlead!.cookie, {
          action: 'confirm',
        })
      ).statusCode,
    ).toBe(403);
    seen = (
      await call('POST', '/api/requests/REQ-1/requester-actions', people.agent!.cookie, {
        action: 'confirm',
      })
    ).json<RequestView>();
    expect(seen.status).toBe('closed');
  });

  it('declines with a public reason', async () => {
    await openRequest();
    await call('POST', '/api/requests/REQ-1/actions', people.itlead!.cookie, {
      action: 'decline',
      reason: 'Use self-service',
    });
    const seen = (
      await call('GET', '/api/requests/REQ-1', people.agent!.cookie)
    ).json<RequestView>();
    expect(seen.status).toBe('declined');
    expect(seen.comments.at(-1)!.body).toBe('Use self-service');
  });

  it('spawns issues; the requester sees progress only', async () => {
    await openRequest();
    const spawned = (
      await call('POST', '/api/requests/REQ-1/issues', people.itmember!.cookie, {
        title: 'Create VPN profile',
      })
    ).json<RequestView>();
    expect(spawned.linkedIssues).toEqual({
      kind: 'details',
      items: [{ identifier: 'HELP-1', title: 'Create VPN profile', done: false }],
    });
    const asRequester = (
      await call('GET', '/api/requests/REQ-1', people.agent!.cookie)
    ).json<RequestView>();
    expect(asRequester.linkedIssues).toEqual({ kind: 'progress', done: 0, total: 1 });
    expect(JSON.stringify(asRequester)).not.toContain('HELP-1');
  });

  it('hides requests from unrelated members', async () => {
    await openRequest();
    expect((await call('GET', '/api/requests/REQ-1', people.accountant!.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await call('GET', '/api/teams/HELP/requests', people.accountant!.cookie)).statusCode,
    ).toBe(404);
  });

  it('lists my requests', async () => {
    await openRequest();
    const mine = (await call('GET', '/api/me/requests', people.agent!.cookie)).json<
      RequestSummary[]
    >();
    expect(mine.map((r) => [r.identifier, r.department.name])).toEqual([['REQ-1', 'IT']]);
  });
});

describe('request groups (MVP criteria 12)', () => {
  async function newHire(extraApprovals: object[]) {
    const laptop = await requestType(ids.it, {
      name: 'Laptop',
      targetTeamId: ids.help,
      allowRequesterApprovals: true,
    });
    const payroll = await requestType(ids.finance, {
      name: 'Payroll setup',
      targetTeamId: ids.acc,
      allowRequesterApprovals: true,
    });
    const submitted = await call('POST', '/api/request-groups', people.agent!.cookie, {
      title: 'New hire: Ann',
      items: [{ requestTypeId: laptop.id }, { requestTypeId: payroll.id }],
      extraApprovals,
    });
    expect(submitted.statusCode).toBe(201);
    return submitted.json<RequestGroupView>();
  }

  it('releases one child per department after the group approval', async () => {
    const group = await newHire([{ selector: { type: 'requester_department_supervisor' } }]);
    expect(group).toMatchObject({ identifier: 'REQ-G-1', status: 'pending_approval' });
    expect(group.children.map((c) => [c.department.name, c.status])).toEqual([
      ['IT', 'pending_approval'],
      ['Finance', 'pending_approval'],
    ]);
    expect(await queue('HELP', people.itlead!.cookie)).toEqual([]);

    const decided = (
      await decide(people.csboss!.cookie, group.approvals[0]!.id, { decision: 'approve' })
    ).json<{ group: RequestGroupView }>().group;
    expect(decided.status).toBe('in_progress');
    expect((await queue('HELP', people.itlead!.cookie)).map((r) => r.title)).toEqual([
      'New hire: Ann',
    ]);
    expect((await queue('ACC', people.accountant!.cookie)).map((r) => r.title)).toEqual([
      'New hire: Ann',
    ]);

    // Each department sees its own child and the siblings' statuses only.
    const itChild = decided.children[0]!;
    const asIt = (
      await call('GET', `/api/requests/${itChild.identifier}`, people.itlead!.cookie)
    ).json<RequestView>();
    expect(asIt.siblings).toMatchObject([{ department: { name: 'Finance' }, status: 'open' }]);

    for (const [child, lead] of [
      [decided.children[0]!, people.itlead!],
      [decided.children[1]!, people.accountant!],
    ] as const) {
      await call('POST', `/api/requests/${child.identifier}/actions`, lead.cookie, {
        action: 'accept',
      });
      await call('POST', `/api/requests/${child.identifier}/actions`, lead.cookie, {
        action: 'resolve',
      });
    }
    const done = (
      await call('GET', '/api/request-groups/REQ-G-1', people.agent!.cookie)
    ).json<RequestGroupView>();
    expect(done.status).toBe('resolved');
  });

  it('a group rejection rejects every child', async () => {
    const group = await newHire([{ selector: { type: 'requester_department_supervisor' } }]);
    await decide(people.csboss!.cookie, group.approvals[0]!.id, {
      decision: 'reject',
      comment: 'Hiring frozen',
    });
    const seen = (
      await call('GET', '/api/request-groups/REQ-G-1', people.agent!.cookie)
    ).json<RequestGroupView>();
    expect(seen.status).toBe('rejected');
    expect(seen.children.map((c) => c.status)).toEqual(['rejected', 'rejected']);
  });

  it('needs one request type per department', async () => {
    const a = await requestType(ids.it, { name: 'A', targetTeamId: ids.help });
    const b = await requestType(ids.it, { name: 'B', targetTeamId: ids.help });
    const result = await call('POST', '/api/request-groups', people.agent!.cookie, {
      title: 'x',
      items: [{ requestTypeId: a.id }, { requestTypeId: b.id }],
    });
    expect(result.statusCode).toBe(400);
  });
});

describe('request types', () => {
  it('lets department admins manage only their department', async () => {
    await person('itadmin', { role: 'department_admin', scope: dept(ids.it) });
    const mine = await call(
      'POST',
      `/api/admin/departments/${ids.it}/request-types`,
      people.itadmin!.cookie,
      {
        name: 'Software',
        targetTeamId: ids.help,
      },
    );
    expect(mine.statusCode).toBe(201);
    const other = await call(
      'POST',
      `/api/admin/departments/${ids.finance}/request-types`,
      people.itadmin!.cookie,
      {
        name: 'Software',
        targetTeamId: ids.acc,
      },
    );
    expect(other.statusCode).toBe(403);
    const member = await call(
      'POST',
      `/api/admin/departments/${ids.it}/request-types`,
      people.agent!.cookie,
      {
        name: 'Software',
        targetTeamId: ids.help,
      },
    );
    expect(member.statusCode).toBe(403);
  });

  it('routes only to teams of the same department', async () => {
    const result = await call('POST', `/api/admin/departments/${ids.it}/request-types`, owner, {
      name: 'Wrong',
      targetTeamId: ids.acc,
    });
    expect(result.statusCode).toBe(400);
  });

  it('lists portals with active types', async () => {
    const type = await requestType(ids.it, { name: 'VPN access', targetTeamId: ids.help });
    await requestType(ids.finance, { name: 'Expense', targetTeamId: ids.acc });
    await call('POST', `/api/admin/request-types/${type.id}/archive`, owner);
    const portals = (await call('GET', '/api/portals', people.agent!.cookie)).json<
      Array<{ department: { name: string }; requestTypes: Array<{ name: string }> }>
    >();
    expect(portals.map((p) => [p.department.name, p.requestTypes.map((r) => r.name)])).toEqual([
      ['Finance', ['Expense']],
    ]);
    const archived = await call('POST', '/api/requests', people.agent!.cookie, {
      requestTypeId: type.id,
      title: 'x',
    });
    expect(archived.json()).toEqual({ error: 'request_type_archived' });
  });
});
