import { createHmac } from 'node:crypto';
import type { IssueDetail, SlackAppView, SlackLinkView } from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog, members, slackLinks } from '../db/schema.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import type { SlackHttp } from './slack-api.js';
import { CALLBACKS } from './slack-app.service.js';

const BOT = 'xoxb-1-test-bot';
const APP = 'xapp-1-test-app';
const SIGNING = 'a'.repeat(32);
const CLIENT_ID = '1111.2222';
const CLIENT_SECRET = 'b'.repeat(32);

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256' }],
  });
});

let t: TestApp;
let owner: string;
let ownerId: string;
let teamId: string;
let calls: Array<{ method: string; body: Record<string, unknown> }>;
let idClaims: JWTPayload;

/** Fake Slack: answers the Web API methods Ordler uses and records every call. */
const slackHttp: SlackHttp = async (url, init) => {
  const method = url.replace('https://slack.com/api/', '');
  const body = init.headers['content-type']?.startsWith('application/json')
    ? (JSON.parse(init.body ?? '{}') as Record<string, unknown>)
    : Object.fromEntries(new URLSearchParams(init.body ?? ''));
  calls.push({ method, body });
  const ok = (extra: object = {}) => Response.json({ ok: true, ...extra });
  switch (method) {
    case 'auth.test':
      return init.headers.authorization === `Bearer ${BOT}`
        ? ok({ team_id: 'T1', team: 'Push30', user_id: 'UBOT' })
        : Response.json({ ok: false, error: 'invalid_auth' });
    case 'conversations.list':
      return ok({
        channels: [
          { id: 'C02SUPPORT', name: 'support' },
          { id: 'C01ALERTS', name: 'it-alerts' },
        ],
      });
    case 'conversations.info':
      return ok({ channel: { id: body.channel, name: 'it-alerts', is_private: false } });
    case 'openid.connect.token': {
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT(idClaims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://slack.com')
        .setAudience(CLIENT_ID)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(keys.privateKey);
      return ok({ id_token: idToken });
    }
    default:
      return ok();
  }
};

function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  options: { cookie?: string; payload?: object | string; headers?: Record<string, string> } = {},
) {
  return t.app.inject({
    method,
    url,
    headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers },
    ...(options.payload !== undefined ? { payload: options.payload } : {}),
  });
}

const SETTINGS = {
  enabled: true,
  mode: 'socket',
  botToken: BOT,
  appToken: APP,
  signingSecret: SIGNING,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
};

async function configure(extra: object = {}) {
  const response = await call('PUT', '/api/admin/slack-app', {
    cookie: owner,
    payload: { ...SETTINGS, ...extra },
  });
  expect(response.statusCode).toBe(200);
  return response.json<SlackAppView>();
}

async function linkOwner(slackUserId = 'U1') {
  await t.database.db
    .insert(slackLinks)
    .values({ memberId: ownerId, workspaceId: 'T1', slackUserId });
}

async function issue(): Promise<IssueDetail> {
  const response = await call('POST', '/api/teams/HELP/issues', {
    cookie: owner,
    payload: { title: 'VPN drops every hour' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<IssueDetail>();
}

beforeEach(async () => {
  calls = [];
  t = await createTestApp({ slackHttp, slackJwks: jwks });
  const setup = await call('POST', '/api/setup', {
    payload: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  ownerId = (await t.database.db.select().from(members).where(eq(members.email, OWNER.email)))[0]!
    .id;
  const department = (
    await call('POST', '/api/admin/departments', { cookie: owner, payload: { name: 'IT' } })
  ).json<{ id: string }>().id;
  teamId = (
    await call('POST', `/api/admin/departments/${department}/teams`, {
      cookie: owner,
      payload: { name: 'Helpdesk', key: 'HELP' },
    })
  ).json<{ id: string }>().id;
});
afterEach(() => t.close());

describe('Admin → Slack app', () => {
  it('learns the workspace from the bot token and never returns or audits secrets', async () => {
    const view = await configure();
    expect(view).toMatchObject({
      enabled: true,
      mode: 'socket',
      workspace: { id: 'T1', name: 'Push30' },
      botTokenSet: true,
      appTokenSet: true,
      signingSecretSet: true,
      clientId: CLIENT_ID,
      clientSecretSet: true,
      urls: { redirect: `${TEST_BASE_URL}/api/me/slack/callback` },
    });
    const body = (await call('GET', '/api/admin/slack-app', { cookie: owner })).body;
    for (const secret of [BOT, APP, SIGNING, CLIENT_SECRET]) expect(body).not.toContain(secret);
    const audit = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'slack_app.updated'));
    expect(JSON.stringify(audit)).not.toContain(BOT);
  });

  it('refuses a bad bot token and Socket Mode without an app token', async () => {
    const bad = await call('PUT', '/api/admin/slack-app', {
      cookie: owner,
      payload: { ...SETTINGS, botToken: 'xoxb-wrong' },
    });
    expect(bad.json()).toEqual({ error: 'slack_rejected' });
    const noApp = await call('PUT', '/api/admin/slack-app', {
      cookie: owner,
      payload: { ...SETTINGS, appToken: null },
    });
    expect(noApp.statusCode).toBe(409);
  });

  it('ships a manifest for this installation', async () => {
    await configure();
    const manifest = (await call('GET', '/api/admin/slack-app/manifest', { cookie: owner })).json<{
      features: { unfurl_domains: string[]; shortcuts: Array<{ callback_id: string }> };
      oauth_config: { redirect_urls: string[] };
      settings: { socket_mode_enabled: boolean };
    }>();
    expect(manifest.features.unfurl_domains).toEqual(['ordler.test']);
    expect(manifest.features.shortcuts.map((s) => s.callback_id)).toEqual([
      CALLBACKS.createIssue,
      CALLBACKS.createRequest,
    ]);
    expect(manifest.oauth_config.redirect_urls).toEqual([`${TEST_BASE_URL}/api/me/slack/callback`]);
    expect(manifest.settings.socket_mode_enabled).toBe(true);
  });

  it('is for organization admins only', async () => {
    const invite = (
      await call('POST', '/api/admin/members', {
        cookie: owner,
        payload: { email: 'ann@push30.test', name: 'Ann' },
      })
    ).json<{ inviteUrl: string }>();
    const accepted = await call('POST', '/api/invites/accept', {
      payload: {
        token: invite.inviteUrl.split('/invite/')[1],
        name: 'Ann',
        password: 'ann-password-123',
      },
    });
    const ann = cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE);
    expect((await call('GET', '/api/admin/slack-app', { cookie: ann })).statusCode).toBe(403);
    expect(
      (await call('PUT', '/api/admin/slack-app', { cookie: ann, payload: SETTINGS })).statusCode,
    ).toBe(403);
    expect(
      (await call('GET', '/api/integrations/slack/channels', { cookie: ann })).statusCode,
    ).toBe(403);
  });
});

describe('linking a Slack account', () => {
  async function startLink() {
    const start = await call('GET', '/api/me/slack/start', { cookie: owner });
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.origin + location.pathname).toBe('https://slack.com/openid/connect/authorize');
    expect(location.searchParams.get('team')).toBe('T1');
    const state = cookieFrom(start.headers['set-cookie'], 'ordler_slack_link');
    return {
      state: location.searchParams.get('state')!,
      nonce: location.searchParams.get('nonce')!,
      cookie: `${owner}; ${state}`,
    };
  }

  it('links through Sign in with Slack and can be undone', async () => {
    await configure();
    const flow = await startLink();
    idClaims = {
      sub: 'U1',
      nonce: flow.nonce,
      'https://slack.com/user_id': 'U1',
      'https://slack.com/team_id': 'T1',
    };
    const callback = await call('GET', `/api/me/slack/callback?code=c1&state=${flow.state}`, {
      cookie: flow.cookie,
    });
    expect(callback.headers.location).toBe(`${TEST_BASE_URL}/settings/slack?slack=linked`);
    expect((await call('GET', '/api/me/slack', { cookie: owner })).json<SlackLinkView>()).toEqual({
      available: true,
      linked: true,
      workspace: 'Push30',
      directMessages: true,
    });

    await call('DELETE', '/api/me/slack', { cookie: owner });
    expect(
      (await call('GET', '/api/me/slack', { cookie: owner })).json<SlackLinkView>().linked,
    ).toBe(false);
  });

  it('refuses a Slack user from another workspace, a forged state and a wrong nonce', async () => {
    await configure();
    let flow = await startLink();
    idClaims = {
      nonce: flow.nonce,
      'https://slack.com/user_id': 'U9',
      'https://slack.com/team_id': 'T-OTHER',
    };
    const other = await call('GET', `/api/me/slack/callback?code=c&state=${flow.state}`, {
      cookie: flow.cookie,
    });
    expect(other.headers.location).toBe(`${TEST_BASE_URL}/settings/slack?slack_error=oauth_failed`);

    flow = await startLink();
    const forged = await call('GET', '/api/me/slack/callback?code=c&state=forged', {
      cookie: flow.cookie,
    });
    expect(forged.headers.location).toContain('slack_error=oauth_failed');

    flow = await startLink();
    idClaims = {
      nonce: 'other',
      'https://slack.com/user_id': 'U1',
      'https://slack.com/team_id': 'T1',
    };
    const nonce = await call('GET', `/api/me/slack/callback?code=c&state=${flow.state}`, {
      cookie: flow.cookie,
    });
    expect(nonce.headers.location).toContain('slack_error=oauth_failed');
    expect(await t.database.db.select().from(slackLinks)).toHaveLength(0);
  });

  it('is unavailable until the admin enters the client credentials', async () => {
    await configure({ clientId: null, clientSecret: null });
    expect(
      (await call('GET', '/api/me/slack', { cookie: owner })).json<SlackLinkView>().available,
    ).toBe(false);
    const start = await call('GET', '/api/me/slack/start', { cookie: owner });
    expect(start.headers.location).toBe(
      `${TEST_BASE_URL}/settings/slack?slack_error=slack_not_configured`,
    );
  });
});

describe('messages from Ordler', () => {
  it('sends Inbox events as DMs to linked members who keep them on', async () => {
    await configure();
    await linkOwner();
    const created = await issue();
    calls.length = 0;
    await t.ctx.notifications.notify({
      recipients: [ownerId],
      kind: 'issue_assigned',
      actorId: null,
      subject: { type: 'issue', id: created.id },
    });
    await t.ctx.notifications.flush();
    const dm = calls.find((c) => c.method === 'chat.postMessage');
    expect(dm?.body).toMatchObject({ channel: 'U1' });
    expect(String(dm?.body.text)).toContain('VPN drops every hour');

    await call('PATCH', '/api/me/slack', { cookie: owner, payload: { directMessages: false } });
    calls.length = 0;
    await t.ctx.notifications.notify({
      recipients: [ownerId],
      kind: 'issue_assigned',
      actorId: null,
      subject: { type: 'issue', id: created.id },
    });
    await t.ctx.notifications.flush();
    expect(calls.filter((c) => c.method === 'chat.postMessage')).toHaveLength(0);
  });

  it('subscribes a team to a picked channel and posts through the bot', async () => {
    await configure();
    const channels = await call('GET', '/api/integrations/slack/channels', { cookie: owner });
    expect(channels.json()).toEqual([
      { id: 'C01ALERTS', name: 'it-alerts' },
      { id: 'C02SUPPORT', name: 'support' },
    ]);
    const created = await call('POST', '/api/integrations/slack', {
      cookie: owner,
      payload: { teamId, name: 'Alerts', channelId: 'C01ALERTS', events: ['issue_created'] },
    });
    expect(created.json()).toMatchObject({
      channel: { id: 'C01ALERTS', name: 'it-alerts' },
      host: '',
    });

    calls.length = 0;
    await issue();
    await t.ctx.slack.flush();
    expect(calls.find((c) => c.method === 'chat.postMessage')?.body).toMatchObject({
      channel: 'C01ALERTS',
    });
  });
});

describe('messages from Slack', () => {
  it('unfurls an issue link for a linked member who can read it, and nothing otherwise', async () => {
    await configure();
    await linkOwner();
    const created = await issue();
    const event = (user: string) => ({
      type: 'event_callback',
      team_id: 'T1',
      event: {
        type: 'link_shared',
        user,
        channel: 'C01ALERTS',
        message_ts: '1.2',
        links: [{ url: `${TEST_BASE_URL}/issue/${created.identifier}` }],
      },
    });
    calls.length = 0;
    await t.ctx.slackApp.handleEvent(event('U-STRANGER'));
    expect(calls).toHaveLength(0);

    await t.ctx.slackApp.handleEvent(event('U1'));
    const unfurl = calls.find((c) => c.method === 'chat.unfurl');
    expect(unfurl?.body).toMatchObject({ channel: 'C01ALERTS', ts: '1.2' });
    expect(JSON.stringify(unfurl?.body)).toContain('VPN drops every hour');
  });

  it('creates an issue from a message as the linked member', async () => {
    await configure();
    await linkOwner();
    calls.length = 0;
    await t.ctx.slackApp.handleInteraction({
      type: 'message_action',
      callback_id: CALLBACKS.createIssue,
      trigger_id: 'trig',
      team: { id: 'T1' },
      user: { id: 'U1' },
      message: {
        text: 'Printer is out of toner\nfloor 3',
        permalink: 'https://push30.slack.com/p1',
      },
    });
    const open = calls.find((c) => c.method === 'views.open');
    const view = open?.body.view as { blocks: Array<{ element: { initial_value?: string } }> };
    expect(view.blocks[1]!.element.initial_value).toBe('Printer is out of toner');

    const ack = await t.ctx.slackApp.handleInteraction({
      type: 'view_submission',
      team: { id: 'T1' },
      user: { id: 'U1' },
      view: {
        callback_id: CALLBACKS.issueModal,
        private_metadata: JSON.stringify({ permalink: 'https://push30.slack.com/p1' }),
        state: {
          values: {
            target: { value: { selected_option: { value: 'HELP' } } },
            title: { value: { value: 'Printer is out of toner' } },
            description: { value: { value: 'floor 3' } },
          },
        },
      },
    });
    expect(ack).toEqual({ response_action: 'clear' });
    const list = (await call('GET', '/api/teams/HELP/issues', { cookie: owner })).json<
      Array<{ identifier: string; title: string }>
    >();
    expect(list.map((i) => i.title)).toContain('Printer is out of toner');
    expect(calls.at(-1)).toMatchObject({ method: 'chat.postMessage', body: { channel: 'U1' } });
  });

  it('opens nothing for a Slack user who has not linked an account', async () => {
    await configure();
    calls.length = 0;
    await t.ctx.slackApp.handleInteraction({
      type: 'message_action',
      callback_id: CALLBACKS.createIssue,
      trigger_id: 'trig',
      team: { id: 'T1' },
      user: { id: 'U-STRANGER' },
      message: { text: 'hi' },
    });
    expect(calls.filter((c) => c.method === 'views.open')).toHaveLength(0);
  });
});

describe('HTTP mode', () => {
  function signed(body: string, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = `v0=${createHmac('sha256', SIGNING).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    return {
      'content-type': 'application/json',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': signature,
    };
  }

  it('answers the URL check only for correctly signed, fresh requests', async () => {
    await configure({ mode: 'http' });
    const body = JSON.stringify({ type: 'url_verification', challenge: 'xyz' });
    const ok = await call('POST', '/api/slack/events', { payload: body, headers: signed(body) });
    expect(ok.json()).toEqual({ challenge: 'xyz' });

    const forged = await call('POST', '/api/slack/events', {
      payload: body,
      headers: { ...signed(body), 'x-slack-signature': 'v0=00' },
    });
    expect(forged.statusCode).toBe(401);
    const stale = await call('POST', '/api/slack/events', {
      payload: body,
      headers: signed(body, Math.floor(Date.now() / 1000) - 600),
    });
    expect(stale.statusCode).toBe(401);
  });

  it('refuses events while the app runs in Socket Mode', async () => {
    await configure();
    const body = JSON.stringify({ type: 'url_verification', challenge: 'xyz' });
    const response = await call('POST', '/api/slack/events', {
      payload: body,
      headers: signed(body),
    });
    expect(response.statusCode).toBe(401);
  });
});
