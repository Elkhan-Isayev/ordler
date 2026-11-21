import { createHmac, generateKeyPairSync } from 'node:crypto';
import type {
  AdminRole,
  GithubAppView,
  GithubManifestStart,
  InviteResponse,
  IssueDetail,
  IssueGithubView,
  TeamGithubSettings,
  TeamView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog, githubApp } from '../db/schema.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import type { GithubHttp } from './github-api.js';

const { privateKey: PEM } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SECRET = 'whsec-github-test-secret-0123456789';
const REPO = { full_name: 'push30/portal', html_url: 'https://github.com/push30/portal' };

let t: TestApp;
let owner: string;
let team: TeamView;
let dev: { cookie: string; id: string };
let outsider: { cookie: string; id: string };
let calls: Array<{ method: string; url: string; headers: Record<string, string>; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
let nextCommentId: number;
let failComments: boolean;

/** Fake GitHub REST API: records every call. */
const githubHttp: GithubHttp = async (url, init) => {
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method: init.method, url, headers: init.headers, body });
  if (url.includes('/app-manifests/good-code/conversions')) {
    return Response.json({
      id: 4242,
      slug: 'ordler-push30',
      pem: PEM,
      webhook_secret: SECRET,
      client_secret: 'c'.repeat(40),
    });
  }
  if (url.includes('/app-manifests/')) return new Response('{}', { status: 404 });
  if (url.endsWith('/access_tokens')) {
    return Response.json({ token: 'ghs_installation', expires_at: '2099-01-01T00:00:00Z' });
  }
  if (failComments) return new Response('{}', { status: 500 });
  if (init.method === 'POST' && url.endsWith('/comments')) {
    nextCommentId += 1;
    return Response.json({ id: nextCommentId });
  }
  return Response.json({});
};

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

let delivery = 0;
function deliver(event: string, payload: object, options: { secret?: string; id?: string } = {}) {
  const body = JSON.stringify({ repository: REPO, sender: { login: 'elkhan' }, ...payload });
  const signature = `sha256=${createHmac('sha256', options.secret ?? SECRET)
    .update(body)
    .digest('hex')}`;
  delivery += 1;
  return t.app.inject({
    method: 'POST',
    url: '/api/github/webhook',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': options.id ?? `delivery-${delivery}`,
      'x-hub-signature-256': signature,
    },
    payload: body,
  });
}

function pullRequest(action: string, pr: object) {
  return deliver('pull_request', {
    action,
    installation: { id: 77 },
    pull_request: {
      number: 5,
      title: 'Fix login',
      body: '',
      state: 'open',
      draft: false,
      merged: false,
      html_url: 'https://github.com/push30/portal/pull/5',
      user: { login: 'elkhan' },
      head: { ref: 'elkhan/help-1-fix-login' },
      ...pr,
    },
  });
}

async function configure() {
  const response = await call('PUT', '/api/admin/github-app', owner, {
    enabled: true,
    githubUrl: 'https://github.com',
    appId: '4242',
    privateKey: PEM,
    webhookSecret: SECRET,
  });
  expect(response.statusCode).toBe(200);
  return response.json<GithubAppView>();
}

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

async function newIssue(teamKey = 'HELP', title = 'Login fails') {
  const response = await call('POST', `/api/teams/${teamKey}/issues`, owner, { title });
  expect(response.statusCode).toBe(201);
  return response.json<IssueDetail>();
}

const links = async (identifier: string, cookie = owner) =>
  (await call('GET', `/api/issues/${identifier}/github`, cookie)).json<IssueGithubView>();
const status = (name: string) => team.statuses.find((s) => s.key === name)!.id;

beforeEach(async () => {
  calls = [];
  nextCommentId = 1000;
  failComments = false;
  t = await createTestApp({ githubHttp });
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
  await call('POST', `/api/admin/departments/${dept.id}/teams`, owner, {
    name: 'Security',
    key: 'SEC',
    isPrivate: true,
  });
  team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const member = roles.find((r) => r.key === 'member')!.id;
  dev = await invite('dev', member, { type: 'team', id: team.id }, [team.id]);
  outsider = await invite('outsider', member, { type: 'department', id: dept.id }, []);
});
afterEach(() => t.close());

describe('Admin → Integrations → GitHub (ADR 0019)', () => {
  it('saves settings, never returns secrets and audits only their names', async () => {
    const view = await configure();
    expect(view).toMatchObject({
      enabled: true,
      githubUrl: 'https://github.com',
      appId: '4242',
      privateKeySet: true,
      webhookSecretSet: true,
      webhookUrl: `${TEST_BASE_URL}/api/github/webhook`,
    });
    expect(JSON.stringify(view)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(view)).not.toContain(SECRET);

    const [row] = await t.database.db.select().from(githubApp);
    expect(row!.secretsEncrypted).not.toContain(SECRET);

    const audit = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'github_app.updated'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(SECRET);
    expect(JSON.stringify(audit[0])).not.toContain('PRIVATE KEY');
    expect(audit[0]!.after).toMatchObject({ changed: ['privateKey', 'webhookSecret'] });
  });

  it('refuses to enable an incomplete app', async () => {
    const response = await call('PUT', '/api/admin/github-app', owner, {
      enabled: true,
      githubUrl: 'https://github.com',
      appId: '4242',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'github_not_configured' });
  });

  it('is for members with integration.manage only', async () => {
    expect((await call('GET', '/api/admin/github-app', dev.cookie)).statusCode).toBe(403);
    expect(
      (
        await call('PUT', '/api/admin/github-app', dev.cookie, {
          enabled: false,
          githubUrl: 'https://github.com',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', '/api/admin/github-app/manifest', dev.cookie, {
          githubUrl: 'https://github.com',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('creates the app from a manifest on GitHub Enterprise Server', async () => {
    const started = await call('POST', '/api/admin/github-app/manifest', owner, {
      githubUrl: 'https://ghe.push30.test/',
      organization: 'push30',
    });
    expect(started.statusCode).toBe(201);
    const start = started.json<GithubManifestStart>();
    const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe(
      'https://ghe.push30.test/organizations/push30/settings/apps/new',
    );
    const manifest = JSON.parse(start.manifest) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(manifest.hook_attributes.url).toBe(`${TEST_BASE_URL}/api/github/webhook`);
    expect(manifest.redirect_url).toBe(`${TEST_BASE_URL}/api/admin/github-app/callback`);
    expect(manifest.default_events).toEqual(['create', 'delete', 'push', 'pull_request']);
    expect(manifest.public).toBe(false);
    const state = cookieFrom(started.headers['set-cookie'], 'ordler_github_manifest');

    const back = await t.app.inject({
      method: 'GET',
      url: `/api/admin/github-app/callback?code=good-code&state=${url.searchParams.get('state')}`,
      headers: { cookie: `${owner}; ${state}` },
    });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe(`${TEST_BASE_URL}/admin/integrations?github=created`);
    expect(calls[0]!.url).toBe(
      'https://ghe.push30.test/api/v3/app-manifests/good-code/conversions',
    );

    const view = (await call('GET', '/api/admin/github-app', owner)).json<GithubAppView>();
    expect(view).toMatchObject({
      enabled: true,
      githubUrl: 'https://ghe.push30.test',
      organization: 'push30',
      appId: '4242',
      appSlug: 'ordler-push30',
      privateKeySet: true,
      webhookSecretSet: true,
      installUrl: 'https://ghe.push30.test/github-apps/ordler-push30/installations/new',
    });
    const audit = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'github_app.created'));
    expect(audit).toHaveLength(1);
  });

  it('rejects a callback without the matching state', async () => {
    const started = await call('POST', '/api/admin/github-app/manifest', owner, {
      githubUrl: 'https://github.com',
    });
    const state = cookieFrom(started.headers['set-cookie'], 'ordler_github_manifest');
    const back = await t.app.inject({
      method: 'GET',
      url: '/api/admin/github-app/callback?code=good-code&state=forged',
      headers: { cookie: `${owner}; ${state}` },
    });
    expect(back.headers.location).toBe(
      `${TEST_BASE_URL}/admin/integrations?github_error=oauth_failed`,
    );
    expect(calls).toEqual([]);
    expect((await call('GET', '/api/admin/github-app', owner)).json()).toMatchObject({
      enabled: false,
      appId: null,
    });
  });
});

describe('GitHub webhooks', () => {
  beforeEach(async () => {
    await configure();
  });

  it('refuses deliveries with a wrong or missing signature', async () => {
    await newIssue();
    const forged = await deliver(
      'create',
      { ref: 'help-1-x', ref_type: 'branch' },
      { secret: 'not-the-secret-0123456789' },
    );
    expect(forged.statusCode).toBe(401);
    const unsigned = await t.app.inject({
      method: 'POST',
      url: '/api/github/webhook',
      headers: { 'content-type': 'application/json', 'x-github-event': 'ping' },
      payload: '{}',
    });
    expect(unsigned.statusCode).toBe(401);
    expect((await links('HELP-1')).links).toEqual([]);
  });

  it('refuses everything while the app is disabled', async () => {
    await call('PUT', '/api/admin/github-app', owner, {
      enabled: false,
      githubUrl: 'https://github.com',
    });
    expect((await deliver('ping', {})).statusCode).toBe(401);
  });

  it('links branches by name in any case and unlinks deleted ones', async () => {
    await newIssue();
    expect(
      (await deliver('create', { ref: 'elkhan/help-1-fix-login', ref_type: 'branch' })).statusCode,
    ).toBe(202);
    // Unknown team keys and other refs are ignored.
    await deliver('create', { ref: 'feature/utf-8', ref_type: 'branch' });
    await deliver('create', { ref: 'v1.0', ref_type: 'tag' });
    expect((await links('HELP-1')).links).toMatchObject([
      {
        kind: 'branch',
        repository: 'push30/portal',
        ref: 'elkhan/help-1-fix-login',
        url: 'https://github.com/push30/portal/tree/elkhan/help-1-fix-login',
        author: 'elkhan',
      },
    ]);
    await deliver('delete', { ref: 'elkhan/help-1-fix-login', ref_type: 'branch' });
    expect((await links('HELP-1')).links).toEqual([]);
  });

  it('links commits by message and handles a redelivery once', async () => {
    await newIssue();
    const push = {
      ref: 'refs/heads/main',
      commits: [
        {
          id: 'a'.repeat(40),
          message: 'Fix HELP-1 timeout\n\nLonger text',
          url: `https://github.com/push30/portal/commit/${'a'.repeat(40)}`,
          author: { name: 'Elkhan', username: 'elkhan' },
        },
        { id: 'b'.repeat(40), message: 'Unrelated', url: 'https://github.com/x' },
      ],
    };
    await deliver('push', push, { id: 'same' });
    expect((await deliver('push', push, { id: 'same' })).statusCode).toBe(202);
    expect((await links('HELP-1')).links).toMatchObject([
      { kind: 'commit', ref: 'a'.repeat(40), title: 'Fix HELP-1 timeout', author: 'elkhan' },
    ]);
  });

  it('links pull requests, tracks their state and comments once', async () => {
    await newIssue();
    await newIssue('SEC', 'Rotate leaked key');
    await pullRequest('opened', { draft: true, body: 'Also SEC-1' });

    let found = (await links('HELP-1')).links;
    expect(found).toMatchObject([
      { kind: 'pull_request', ref: '5', title: 'Fix login', state: 'draft', author: 'elkhan' },
    ]);
    const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/comments'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://api.github.com/repos/push30/portal/issues/5/comments');
    expect(posts[0]!.headers.authorization).toBe('Bearer ghs_installation');
    const body = posts[0]!.body.body as string;
    expect(body).toContain(`[HELP-1](${TEST_BASE_URL}/issue/HELP-1)`);
    expect(body).toContain('Login fails · Todo');
    // A private team shows identifier and link only.
    expect(body).toContain(`[SEC-1](${TEST_BASE_URL}/issue/SEC-1)`);
    expect(body).not.toContain('Rotate leaked key');

    // The app JWT is signed for this app id.
    const tokenCall = calls.find((c) => c.url.endsWith('/app/installations/77/access_tokens'))!;
    expect(decodeJwt(tokenCall.headers.authorization!.replace('Bearer ', '')).iss).toBe('4242');

    await pullRequest('ready_for_review', { body: 'Also SEC-1' });
    expect(calls.filter((c) => c.url.endsWith('/comments'))).toHaveLength(1);

    // Editing the mention away unlinks the issue and edits the comment.
    await pullRequest('edited', { body: '' });
    expect((await links('SEC-1')).links).toEqual([]);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('https://api.github.com/repos/push30/portal/issues/comments/1001');
    expect(patch.body.body).not.toContain('SEC-1');

    await pullRequest('closed', { state: 'closed', merged: true });
    found = (await links('HELP-1')).links;
    expect(found[0]!.state).toBe('merged');
  });

  it('retries the bot comment after a failed post and records the error', async () => {
    await newIssue();
    failComments = true;
    await pullRequest('opened', {});
    expect((await call('GET', '/api/admin/github-app', owner)).json()).toMatchObject({
      lastError: expect.stringContaining('push30/portal#5'),
    });
    failComments = false;
    await pullRequest('edited', {});
    expect(
      calls.filter((c) => c.method === 'POST' && c.url.endsWith('/issues/5/comments')),
    ).toHaveLength(2);
  });

  it('shows links only to members who may read the issue', async () => {
    await newIssue('SEC', 'Rotate leaked key');
    await deliver('create', { ref: 'sec-1-rotate', ref_type: 'branch' });
    expect((await links('SEC-1')).links).toHaveLength(1);
    expect((await call('GET', '/api/issues/SEC-1/github', outsider.cookie)).statusCode).toBe(404);
  });

  it('suggests a branch name for the signed-in member', async () => {
    await newIssue('HELP', 'Fix the login page!');
    expect((await links('HELP-1', dev.cookie)).branchName).toBe('dev/help-1-fix-the-login-page');
  });
});

describe('Team automation', () => {
  beforeEach(async () => {
    await configure();
  });

  it('is off by default', async () => {
    const issue = await newIssue();
    await pullRequest('opened', {});
    await pullRequest('closed', { state: 'closed', merged: true });
    const after = (await call('GET', `/api/issues/${issue.identifier}`, owner)).json<IssueDetail>();
    expect(after.statusId).toBe(issue.statusId);
  });

  it('moves issues when a pull request opens and merges, as a change via GitHub', async () => {
    const saved = await call('PUT', '/api/teams/HELP/github', owner, {
      openedStatusId: status('in_progress'),
      mergedStatusId: status('done'),
    });
    expect(saved.statusCode).toBe(200);
    expect((await call('GET', '/api/teams/HELP/github', owner)).json()).toEqual({
      openedStatusId: status('in_progress'),
      mergedStatusId: status('done'),
    } satisfies TeamGithubSettings);

    await newIssue();
    await pullRequest('opened', {});
    let issue = (await call('GET', '/api/issues/HELP-1', owner)).json<IssueDetail>();
    expect(issue.statusId).toBe(status('in_progress'));
    expect(issue.events.at(-1)).toMatchObject({
      actor: null,
      viaToken: 'GitHub',
      changes: { statusId: { to: status('in_progress') } },
    });
    // The bot comment shows the status automation just set.
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/comments'))!;
    expect(post.body.body).toContain('In Progress');

    await pullRequest('closed', { state: 'closed', merged: true });
    issue = (await call('GET', '/api/issues/HELP-1', owner)).json<IssueDetail>();
    expect(issue.statusId).toBe(status('done'));

    // Reopening never moves finished work back.
    await pullRequest('reopened', {});
    issue = (await call('GET', '/api/issues/HELP-1', owner)).json<IssueDetail>();
    expect(issue.statusId).toBe(status('done'));

    const audit = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'team.github_updated'));
    expect(audit).toHaveLength(1);
  });

  it('does not move closed-unmerged pull requests', async () => {
    await call('PUT', '/api/teams/HELP/github', owner, {
      openedStatusId: null,
      mergedStatusId: status('done'),
    });
    const issue = await newIssue();
    await pullRequest('closed', { state: 'closed', merged: false });
    const after = (await call('GET', '/api/issues/HELP-1', owner)).json<IssueDetail>();
    expect(after.statusId).toBe(issue.statusId);
  });

  it('only accepts statuses of the team', async () => {
    const other = (await call('GET', '/api/teams/SEC', owner)).json<TeamView>();
    const response = await call('PUT', '/api/teams/HELP/github', owner, {
      openedStatusId: other.statuses[0]!.id,
      mergedStatusId: null,
    });
    expect(response.statusCode).toBe(400);
  });

  it('is for members who may manage the team', async () => {
    const payload = { openedStatusId: status('in_progress'), mergedStatusId: null };
    expect((await call('PUT', '/api/teams/HELP/github', dev.cookie, payload)).statusCode).toBe(403);
    expect((await call('GET', '/api/teams/HELP/github', dev.cookie)).statusCode).toBe(403);
    expect((await call('GET', '/api/teams/SEC/github', outsider.cookie)).statusCode).toBe(404);
  });
});
