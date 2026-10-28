import type { AdminRole, InviteResponse, RequestTypeView, RequestView } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];
const ids = {} as Record<'it' | 'fin' | 'help' | 'infra' | 'finTeam', string>;
type Person = 'asker' | 'boss' | 'cfo' | 'itadmin';
const people = {} as Record<Person, { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PATCH';
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

const team = async (departmentId: string, name: string, key: string) =>
  (
    await call('POST', `/api/admin/departments/${departmentId}/teams`, owner, {
      name,
      key,
      isPrivate: false,
    })
  ).json<{ id: string }>().id;

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
  ids.it = await dept('IT');
  ids.fin = await dept('Finance');
  ids.help = await team(ids.it, 'Helpdesk', 'HELP');
  ids.infra = await team(ids.it, 'Infrastructure', 'INFRA');
  ids.finTeam = await team(ids.fin, 'Accounting', 'ACC');
  await person('asker', 'member', ids.fin);
  await person('boss', 'member', ids.fin);
  await person('cfo', 'member', ids.fin);
  await person('itadmin', 'department_admin', ids.it);
});
afterEach(() => t.close());

const user = (name: Person) => ({ type: 'user', memberId: people[name].id });

const FIELDS = [
  { id: 'item', label: 'Item', type: 'select', required: true, options: ['Laptop', 'Headset'] },
  {
    id: 'model',
    label: 'Model',
    type: 'text',
    required: true,
    visibleIf: { fieldId: 'item', op: 'in', values: ['Laptop'] },
  },
  { id: 'amount', label: 'Amount', type: 'number', required: true },
];

function hardware(extra: object = {}) {
  return call('POST', `/api/admin/departments/${ids.it}/request-types`, people.itadmin.cookie, {
    name: 'Hardware',
    targetTeamId: ids.help,
    fields: FIELDS,
    routingRules: [
      { condition: { fieldId: 'item', op: 'in', values: ['Laptop'] }, targetTeamId: ids.infra },
    ],
    approvalSteps: [
      { selector: user('boss') },
      { selector: user('cfo'), condition: { fieldId: 'amount', op: 'gt', value: 1000 } },
    ],
    ...extra,
  });
}

async function submit(typeId: string, formData: object) {
  return call('POST', '/api/requests', people.asker.cookie, {
    requestTypeId: typeId,
    title: 'New hardware',
    formData,
  });
}

const view = async (identifier: string, cookie = owner) =>
  (await call('GET', `/api/requests/${identifier}`, cookie)).json<RequestView>();
const decide = (cookie: string, stepId: string, decision = 'approve', comment?: string) =>
  call('POST', `/api/approvals/${stepId}/decision`, cookie, {
    decision,
    ...(comment ? { comment } : {}),
  });

describe('request type conditions (SPEC §6.1, §6.3)', () => {
  it('saves and shows routing rules and step conditions', async () => {
    const created = await hardware();
    expect(created.statusCode).toBe(201);
    const type = created.json<RequestTypeView>();
    expect(type.routingRules).toEqual([
      {
        condition: { fieldId: 'item', op: 'in', values: ['Laptop'] },
        targetTeamId: ids.infra,
        team: { id: ids.infra, key: 'INFRA', name: 'Infrastructure' },
      },
    ]);
    expect(type.approvalSteps[1]!.condition).toEqual({ fieldId: 'amount', op: 'gt', value: 1000 });
    expect(type.fields[1]!.visibleIf).toEqual({ fieldId: 'item', op: 'in', values: ['Laptop'] });
  });

  it('refuses rules that route outside the department or test unknown fields', async () => {
    const elsewhere = await hardware({
      routingRules: [{ condition: { fieldId: 'item', op: 'set' }, targetTeamId: ids.finTeam }],
    });
    expect(elsewhere.statusCode).toBe(400);
    const unknown = await hardware({
      approvalSteps: [{ selector: user('boss'), condition: { fieldId: 'budget', op: 'set' } }],
    });
    expect(unknown.statusCode).toBe(400);
  });
});

describe('submitting with conditions', () => {
  it('routes by the form and skips steps whose condition does not match', async () => {
    const type = (await hardware()).json<RequestTypeView>();
    const submitted = await submit(type.id, { item: 'Laptop', model: 'X1', amount: 800 });
    expect(submitted.statusCode).toBe(201);
    const request = submitted.json<RequestView>();
    expect(request.targetTeam.key).toBe('INFRA');
    expect(request.approvals.map((s) => s.status)).toEqual(['active', 'skipped']);

    await decide(people.boss.cookie, request.approvals[0]!.id);
    const released = await view(request.identifier);
    expect(released.status).toBe('open');
    expect(released.approvals[1]!.status).toBe('skipped');
  });

  it('runs the conditional step when it matches and uses the default team otherwise', async () => {
    const type = (await hardware()).json<RequestTypeView>();
    const request = (
      await submit(type.id, { item: 'Headset', model: 'ignored', amount: 5000 })
    ).json<RequestView>();
    expect(request.targetTeam.key).toBe('HELP');
    // The hidden model field was cleared, not stored.
    expect(request.formData.model).toBeNull();
    expect(request.approvals.map((s) => s.status)).toEqual(['active', 'waiting']);

    await decide(people.boss.cookie, request.approvals[0]!.id);
    const atCfo = await view(request.identifier);
    expect(atCfo.status).toBe('pending_approval');
    expect(atCfo.approvals[1]!.status).toBe('active');
    expect(atCfo.approvals[1]!.approvers.map((a) => a.name)).toEqual(['cfo']);
  });

  it('requires a field only while it is visible', async () => {
    const type = (await hardware()).json<RequestTypeView>();
    expect((await submit(type.id, { item: 'Laptop', amount: 10 })).statusCode).toBe(400);
    expect((await submit(type.id, { item: 'Headset', amount: 10 })).statusCode).toBe(201);
  });

  it('re-checks pending steps and routing when the requester edits the form', async () => {
    const type = (await hardware()).json<RequestTypeView>();
    const request = (
      await submit(type.id, { item: 'Laptop', model: 'X1', amount: 500 })
    ).json<RequestView>();
    await decide(people.boss.cookie, request.approvals[0]!.id, 'request_changes', 'Need a quote');

    // Raising the amount must not dodge the CFO: the skipped step comes back.
    const resubmitted = await call(
      'POST',
      `/api/requests/${request.identifier}/resubmit`,
      people.asker.cookie,
      { formData: { item: 'Headset', amount: 2500 } },
    );
    expect(resubmitted.statusCode).toBe(200);
    const after = await view(request.identifier);
    expect(after.targetTeam.key).toBe('HELP');
    expect(after.approvals.map((s) => s.status)).toEqual(['active', 'waiting']);
  });

  it('keeps a decided step even if the edited form no longer matches it', async () => {
    const type = (
      await hardware({
        approvalSteps: [
          { selector: user('cfo'), condition: { fieldId: 'amount', op: 'gt', value: 1000 } },
          { selector: user('boss') },
        ],
      })
    ).json<RequestTypeView>();
    const request = (await submit(type.id, { item: 'Headset', amount: 5000 })).json<RequestView>();
    await decide(people.cfo.cookie, request.approvals[0]!.id);
    await decide(people.boss.cookie, request.approvals[1]!.id, 'request_changes', 'Fix title');
    await call('POST', `/api/requests/${request.identifier}/resubmit`, people.asker.cookie, {
      formData: { item: 'Headset', amount: 10 },
    });
    const after = await view(request.identifier);
    expect(after.approvals.map((s) => s.status)).toEqual(['approved', 'active']);
  });
});
