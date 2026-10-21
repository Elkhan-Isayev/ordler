import type {
  AdminRole,
  ChatSubscriptionView,
  InboxCounts,
  InviteResponse,
  NotificationView,
  TeamView,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../db/schema.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { OWNER, testBox } from '../test/fixtures.js';
import { SlackService, type FetchFn } from './slack.service.js';

const WEBHOOK = 'https://hooks.slack.test/services/T0/B0/very-secret-token';

let t: TestApp;
let owner: string;
let team: TeamView;
let dev: { cookie: string; id: string };
let outsider: { cookie: string; id: string };
let posted: Array<{ url: string; body: Record<string, unknown> }>;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

const slackFetch: FetchFn = async (url, init) => {
  posted.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
  return { status: 200, headers: { get: () => null } };
};

async function invite(name: string, roleId: string, scope: object, teamIds: string[]) {
  const created = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name}@push30.test`,
      name,
      role: { roleId, scope },
      teamIds,
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: created.inviteUrl.split('/invite/')[1]!,
    name,
    password: 'person-password-1',
  });
  return {
    cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE),
    id: created.member.id,
  };
}

const inbox = async (cookie: string) =>
  (await call('GET', '/api/me/notifications', cookie)).json<NotificationView[]>();
const counts = async (cookie: string) =>
  (await call('GET', '/api/me/counts', cookie)).json<InboxCounts>();

beforeEach(async () => {
  posted = [];
  t = await createTestApp({ slackFetch });
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
  team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const member = roles.find((r) => r.key === 'member')!.id;
  dev = await invite('dev', member, { type: 'team', id: team.id }, [team.id]);
  outsider = await invite('outsider', member, { type: 'department', id: dept.id }, []);
  t.mailer.sent.length = 0;
});
afterEach(() => t.close());

describe('Inbox and email (SPEC §7)', () => {
  it('tells the assignee, emails only a deep link and never notifies the actor', async () => {
    await call('POST', '/api/teams/HELP/issues', owner, {
      title: 'VPN is down',
      assigneeId: dev.id,
    });
    await t.ctx.notifications.flush();

    const items = await inbox(dev.cookie);
    expect(items).toMatchObject([
      {
        kind: 'issue_assigned',
        subject: {
          type: 'issue',
          identifier: 'HELP-1',
          title: 'VPN is down',
          path: '/issue/HELP-1',
        },
        actor: { name: OWNER.name },
        read: false,
      },
    ]);
    expect(await inbox(owner)).toEqual([]);
    expect(await counts(dev.cookie)).toEqual({ unread: 1, approvals: 0 });

    expect(t.mailer.sent).toHaveLength(1);
    const mail = t.mailer.sent[0]!;
    expect(mail.to).toBe('dev@push30.test');
    expect(mail.subject).toBe(`[Push30] ${OWNER.name} assigned you HELP-1`);
    expect(mail.text).toContain(`${TEST_BASE_URL}/issue/HELP-1`);
  });

  it('notifies watchers about comments, without emailing them', async () => {
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Printer jam' });
    await call('POST', '/api/issues/HELP-1/comments', dev.cookie, { body: 'Looking at it now' });
    await t.ctx.notifications.flush();

    expect((await inbox(owner)).map((n) => n.kind)).toEqual(['issue_commented']);
    expect(await inbox(dev.cookie)).toEqual([]);
    expect(t.mailer.sent).toEqual([]);
  });

  it('marks own notifications read and unread, and ignores other people’s', async () => {
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'A', assigneeId: dev.id });
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'B', assigneeId: dev.id });
    const [latest] = await inbox(dev.cookie);

    // Someone else's ids change nothing.
    const foreign = await call('POST', '/api/me/notifications/mark', outsider.cookie, {
      ids: [latest!.id],
    });
    expect(foreign.json()).toEqual({ unread: 0, approvals: 0 });
    expect(await counts(dev.cookie)).toMatchObject({ unread: 2 });

    const one = await call('POST', '/api/me/notifications/mark', dev.cookie, { ids: [latest!.id] });
    expect(one.json()).toMatchObject({ unread: 1 });
    expect((await inbox(dev.cookie))[0]!.read).toBe(true);

    await call('POST', '/api/me/notifications/mark', dev.cookie, {
      ids: [latest!.id],
      read: false,
    });
    expect(await counts(dev.cookie)).toMatchObject({ unread: 2 });
    await call('POST', '/api/me/notifications/mark', dev.cookie, {});
    expect(await counts(dev.cookie)).toMatchObject({ unread: 0 });
  });

  it('needs a session', async () => {
    expect((await call('GET', '/api/me/notifications')).statusCode).toBe(401);
    expect((await call('GET', '/api/me/counts')).statusCode).toBe(401);
  });
});

describe('Slack channels (SPEC §7.1, MVP criterion 14)', () => {
  async function subscribe(cookie = owner, events = ['issue_created', 'issue_commented']) {
    return call('POST', '/api/integrations/slack', cookie, {
      teamId: team.id,
      name: '#helpdesk',
      webhookUrl: WEBHOOK,
      events,
    });
  }

  it('posts a Block Kit message with an "Open in Ordler" link', async () => {
    expect((await subscribe()).statusCode).toBe(201);
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Server <room> & AC' });
    await t.ctx.slack.flush();

    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe(WEBHOOK);
    const body = posted[0]!.body as {
      text: string;
      blocks: Array<{ type: string; text?: { text: string } }>;
    };
    expect(body.text).toBe('New issue: HELP-1 Server <room> & AC');
    expect(body.blocks[0]!.text!.text).toBe(
      `New issue\n*<${TEST_BASE_URL}/issue/HELP-1|HELP-1>* Server &lt;room&gt; &amp; AC`,
    );
    expect(body.blocks.at(-1)).toEqual({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in Ordler' },
          url: `${TEST_BASE_URL}/issue/HELP-1`,
        },
      ],
    });
  });

  it('only sends subscribed events', async () => {
    await subscribe(owner, ['issue_commented']);
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Quiet' });
    await t.ctx.slack.flush();
    expect(posted).toEqual([]);
    await call('POST', '/api/issues/HELP-1/comments', owner, { body: 'Now loud' });
    await t.ctx.slack.flush();
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted[0]!.body)).toContain('Now loud');
  });

  it('never returns or audits the webhook URL', async () => {
    const created = await subscribe();
    const listed = await call('GET', '/api/integrations/slack', owner);
    for (const response of [created, listed])
      expect(response.body).not.toContain('very-secret-token');
    expect(listed.json<ChatSubscriptionView[]>()).toMatchObject([
      { name: '#helpdesk', host: 'hooks.slack.test', team: { key: 'HELP' } },
    ]);
    const audit = await t.ctx.db.select().from(auditLog);
    expect(JSON.stringify(audit)).not.toContain('very-secret-token');
    expect(audit.some((row) => row.action === 'chat_subscription.created')).toBe(true);
  });

  it('lets only people who manage the team configure channels', async () => {
    expect((await subscribe(dev.cookie)).statusCode).toBe(403);
    const id = (await subscribe()).json<ChatSubscriptionView>().id;
    expect((await call('GET', '/api/integrations/slack', dev.cookie)).json()).toEqual([]);
    expect((await call('POST', `/api/integrations/slack/${id}/test`, dev.cookie)).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/api/integrations/slack/${id}`, dev.cookie)).statusCode).toBe(
      403,
    );

    const test = await call('POST', `/api/integrations/slack/${id}/test`, owner);
    expect(test.json()).toEqual({ sent: true, status: 200 });
    expect(posted.at(-1)!.body).toEqual({
      text: 'Ordler is connected to this channel for Helpdesk.',
    });

    expect((await call('DELETE', `/api/integrations/slack/${id}`, owner)).statusCode).toBe(204);
    expect((await call('GET', '/api/integrations/slack', owner)).json()).toEqual([]);
  });

  it('retries after 429 using Retry-After, and gives up on 4xx', async () => {
    const statuses = [429, 500, 200];
    const waits: number[] = [];
    const calls: string[] = [];
    const slack = new SlackService({
      db: t.ctx.db,
      box: testBox(),
      access: t.ctx.access,
      baseUrl: TEST_BASE_URL,
      fetch: async (url) => {
        calls.push(url);
        const status = statuses.shift()!;
        return { status, headers: { get: (name) => (name === 'retry-after' ? '7' : null) } };
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const ownerId = (await call('GET', '/api/me', owner)).json<{ member: { id: string } }>().member
      .id;
    const sub = await slack.create(ownerId, {
      teamId: team.id,
      name: '#ops',
      webhookUrl: WEBHOOK,
      events: ['issue_created'],
    });
    expect(await slack.test(ownerId, sub.id)).toEqual({ sent: true, status: 200 });
    expect(waits).toEqual([7000, 2000]);

    statuses.push(404, 200);
    expect(await slack.test(ownerId, sub.id)).toEqual({ sent: false, status: 404 });
    expect(calls).toHaveLength(4);
  });
});
