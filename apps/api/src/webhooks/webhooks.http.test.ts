import { createHmac } from 'node:crypto';
import type {
  AdminRole,
  InviteResponse,
  RequestTypeView,
  RequestView,
  WebhookDeliveryView,
  WebhookEnvelope,
  WebhookView,
  WebhookWithSecret,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { webhookEndpoints } from '../db/schema.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { OWNER, testClock } from '../test/fixtures.js';
import { RETRY_DELAYS_MS, type WebhookFetch } from './webhook.service.js';

interface Received {
  url: string;
  headers: Record<string, string>;
  body: string;
}

let t: TestApp;
let owner: string;
let clock: ReturnType<typeof testClock>;
let received: Received[];
let answer: number | Error;
const ids = {} as Record<'it' | 'help' | 'ops', string>;
const people = {} as Record<'member' | 'boss', { cookie: string; id: string }>;

const fakeFetch: WebhookFetch = (url, init) => {
  received.push({ url, headers: init.headers, body: init.body });
  return answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ status: answer });
};

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

beforeEach(async () => {
  received = [];
  answer = 200;
  clock = testClock();
  t = await createTestApp({ webhookFetch: fakeFetch, now: clock.now });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  ids.it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>().id;
  const team = async (name: string, key: string) =>
    (
      await call('POST', `/api/admin/departments/${ids.it}/teams`, owner, {
        name,
        key,
        isPrivate: false,
      })
    ).json<{ id: string }>().id;
  ids.help = await team('Helpdesk', 'HELP');
  ids.ops = await team('Operations', 'OPS');
  for (const name of ['member', 'boss'] as const) {
    const invite = (
      await call('POST', '/api/admin/members', owner, {
        email: `${name}@push30.test`,
        name,
        role: {
          roleId: roles.find((r) => r.key === 'member')!.id,
          scope: { type: 'department', id: ids.it },
        },
        teamIds: [ids.help],
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
});
afterEach(() => t.close());

async function endpoint(body: object = {}): Promise<WebhookWithSecret> {
  const created = await call('POST', '/api/admin/webhooks', owner, {
    name: 'CI bridge',
    url: 'https://hooks.example.test/ordler',
    events: ['issue.created', 'issue.updated', 'issue.commented', 'issue.deleted'],
    ...body,
  });
  expect(created.statusCode).toBe(201);
  return created.json<WebhookWithSecret>();
}

/** Loose view of every event's data, enough for assertions. */
interface Data {
  issue: { identifier: string } & Record<string, unknown>;
  request: unknown;
  changes: unknown;
  comment: unknown;
  decision: unknown;
  webhook: unknown;
}
const envelopes = () => received.map((r) => JSON.parse(r.body) as WebhookEnvelope<Data>);

async function deliveries(id: string) {
  return (await call('GET', `/api/admin/webhooks/${id}/deliveries`, owner)).json<
    WebhookDeliveryView[]
  >();
}

describe('webhooks (SPEC §10)', () => {
  it('are managed by admins only and show the secret once', async () => {
    const denied = await call('POST', '/api/admin/webhooks', people.member.cookie, {
      name: 'x',
      url: 'https://hooks.example.test',
      events: ['issue.created'],
    });
    expect(denied.statusCode).toBe(403);
    expect((await call('GET', '/api/admin/webhooks', people.member.cookie)).statusCode).toBe(403);
    expect(
      (
        await call('POST', '/api/admin/webhooks', owner, {
          name: 'x',
          url: 'ftp://hooks.example.test',
          events: ['issue.created'],
        })
      ).statusCode,
    ).toBe(400);

    const { webhook, secret } = await endpoint();
    expect(secret).toMatch(/^whsec_/);
    expect(webhook.scope).toEqual({ type: 'organization' });
    const listed = await call('GET', '/api/admin/webhooks', owner);
    expect(listed.body).not.toContain(secret);
    const [row] = await t.ctx.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, webhook.id));
    expect(row!.secretEncrypted).not.toContain(secret);

    const rotated = (
      await call('POST', `/api/admin/webhooks/${webhook.id}/rotate-secret`, owner)
    ).json<WebhookWithSecret>();
    expect(rotated.secret).not.toBe(secret);
  });

  it('sends signed issue events with the issue, changes and comments', async () => {
    const { webhook, secret } = await endpoint();
    const created = await call('POST', '/api/teams/HELP/issues', people.member.cookie, {
      title: 'Printer jam',
    });
    const identifier = created.json<{ identifier: string }>().identifier;
    await call('PATCH', `/api/issues/${identifier}`, people.member.cookie, { priority: 'high' });
    await call('POST', `/api/issues/${identifier}/comments`, people.member.cookie, {
      body: 'On it',
    });
    // Nothing is sent inside the request: the worker does it.
    expect(received).toHaveLength(0);
    expect(await t.ctx.webhooks.tick()).toBe(3);

    expect(envelopes().map((e) => e.type)).toEqual([
      'issue.created',
      'issue.updated',
      'issue.commented',
    ]);
    const [first, update, comment] = envelopes();
    expect(first!.actor).toEqual({ id: people.member.id, name: 'member' });
    expect(first!.data.issue).toMatchObject({
      identifier: 'HELP-1',
      url: `${TEST_BASE_URL}/issue/HELP-1`,
      title: 'Printer jam',
      team: { key: 'HELP' },
    });
    expect(update!.data.changes).toEqual({ priority: { from: 'none', to: 'high' } });
    expect(comment!.data.comment).toMatchObject({ body: 'On it' });

    const sent = received[0]!;
    expect(sent.url).toBe('https://hooks.example.test/ordler');
    expect(sent.headers['ordler-event']).toBe('issue.created');
    const [, t1, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sent.headers['ordler-signature']!)!;
    expect(v1).toBe(createHmac('sha256', secret).update(`${t1}.${sent.body}`).digest('hex'));
    expect(Number(t1)).toBe(Math.floor(clock.now().getTime() / 1000));

    const log = await deliveries(webhook.id);
    expect(log.every((d) => d.status === 'succeeded' && d.responseStatus === 200)).toBe(true);
    // Already delivered: nothing left to send.
    expect(await t.ctx.webhooks.tick()).toBe(0);
  });

  it('sends only the subscribed events inside the endpoint scope', async () => {
    await endpoint({ events: ['issue.deleted'], scope: { type: 'team', id: ids.help } });
    await endpoint({ events: ['issue.created'], scope: { type: 'team', id: ids.ops } });
    const created = await call('POST', '/api/teams/HELP/issues', owner, { title: 'Old' });
    const identifier = created.json<{ identifier: string }>().identifier;
    await call('DELETE', `/api/issues/${identifier}`, owner);
    await t.ctx.webhooks.tick();
    expect(envelopes().map((e) => [e.type, e.data.issue.identifier])).toEqual([
      ['issue.deleted', 'HELP-1'],
    ]);
  });

  it('retries failures with backoff and gives up after the last attempt', async () => {
    const { webhook } = await endpoint({ events: ['issue.created'] });
    answer = 500;
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Flaky' });
    await t.ctx.webhooks.tick();
    let [delivery] = await deliveries(webhook.id);
    expect(delivery).toMatchObject({ status: 'pending', attempts: 1, error: 'HTTP 500' });
    expect(delivery!.nextAttemptAt).toBe(
      new Date(clock.now().getTime() + RETRY_DELAYS_MS[0]!).toISOString(),
    );
    // Not due yet.
    expect(await t.ctx.webhooks.tick()).toBe(0);

    answer = new Error('connect ECONNREFUSED');
    for (const delay of RETRY_DELAYS_MS) {
      clock.advance(delay);
      expect(await t.ctx.webhooks.tick()).toBe(1);
    }
    [delivery] = await deliveries(webhook.id);
    expect(delivery).toMatchObject({
      status: 'failed',
      attempts: RETRY_DELAYS_MS.length + 1,
      error: 'connect ECONNREFUSED',
      nextAttemptAt: null,
    });
    expect(
      (await call('GET', '/api/admin/webhooks', owner)).json<WebhookView[]>()[0]!.recentFailures,
    ).toBe(1);

    // A redelivery is a fresh attempt with the same event.
    answer = 204;
    const again = await call(
      'POST',
      `/api/admin/webhooks/deliveries/${delivery!.id}/redeliver`,
      owner,
    );
    expect(again.json<WebhookDeliveryView>().status).toBe('pending');
    await t.ctx.webhooks.tick();
    const ids = envelopes().map((e) => e.id);
    expect(new Set(ids).size).toBe(1);
    expect((await deliveries(webhook.id))[0]!.status).toBe('succeeded');
  });

  it('sends a test ping and stops sending once disabled', async () => {
    const { webhook } = await endpoint();
    const ping = await call('POST', `/api/admin/webhooks/${webhook.id}/test`, owner);
    expect(ping.json<WebhookDeliveryView>().event).toBe('ping');
    await t.ctx.webhooks.tick();
    expect(envelopes()[0]).toMatchObject({
      type: 'ping',
      data: { webhook: { name: 'CI bridge' } },
    });

    await call('PATCH', `/api/admin/webhooks/${webhook.id}`, owner, { enabled: false });
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Quiet' });
    await t.ctx.webhooks.tick();
    expect(received).toHaveLength(1);

    expect((await call('DELETE', `/api/admin/webhooks/${webhook.id}`, owner)).statusCode).toBe(204);
    expect((await call('GET', '/api/admin/webhooks', owner)).json()).toEqual([]);
  });

  it('sends request, approval and status events', async () => {
    await endpoint({
      events: [
        'request.created',
        'approval.requested',
        'approval.decided',
        'request.status_changed',
        'request.commented',
      ],
      scope: { type: 'department', id: ids.it },
    });
    const type = (
      await call('POST', `/api/admin/departments/${ids.it}/request-types`, owner, {
        name: 'Access',
        targetTeamId: ids.help,
        fields: [],
        approvalSteps: [{ selector: { type: 'user', memberId: people.boss.id } }],
      })
    ).json<RequestTypeView>();
    const submitted = (
      await call('POST', '/api/requests', people.member.cookie, {
        requestTypeId: type.id,
        title: 'VPN access',
        formData: {},
      })
    ).json<RequestView>();
    await call(
      'POST',
      `/api/approvals/${submitted.approvals[0]!.id}/decision`,
      people.boss.cookie,
      {
        decision: 'approve',
      },
    );
    await call('POST', `/api/requests/${submitted.identifier}/comments`, people.member.cookie, {
      body: 'Thanks',
      internal: false,
    });
    await t.ctx.webhooks.tick();
    const events = envelopes();
    expect(events.map((e) => e.type)).toEqual([
      'request.created',
      'approval.requested',
      'approval.decided',
      'request.status_changed',
      'request.commented',
    ]);
    expect(events[0]!.data.request).toMatchObject({
      identifier: submitted.identifier,
      title: 'VPN access',
      requestType: 'Access',
      team: { key: 'HELP' },
      requester: { id: people.member.id },
      url: `${TEST_BASE_URL}/requests/${submitted.identifier}`,
    });
    expect(events[2]!.data.decision).toEqual({ decision: 'approve', comment: null });
    expect(events[3]!.data.changes).toEqual({ status: { from: 'pending_approval', to: 'open' } });
    expect(events[4]!.data.comment).toEqual({ body: 'Thanks', visibility: 'public' });
  });
});
