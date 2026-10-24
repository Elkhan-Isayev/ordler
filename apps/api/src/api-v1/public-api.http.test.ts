import type {
  AdminRole,
  CreatedToken,
  InviteResponse,
  IssueDetail,
  IssueSummary,
  RequestTypeView,
  RequestView,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import { RateLimiter } from '../auth/rate-limiter.js';
import { paginate } from './public-api.js';

let t: TestApp;
let owner: string;
const ids = {} as Record<'it' | 'help' | 'secret', string>;
const people = {} as Record<'dev' | 'boss', { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PATCH';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

function api(
  token: string,
  method: Method,
  path: string,
  payload?: object,
  headers: Record<string, string> = {},
) {
  return t.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { authorization: `Bearer ${token}`, ...headers },
    ...(payload ? { payload } : {}),
  });
}

async function token(cookie: string, scopes: string[]) {
  return (
    await call('POST', '/api/me/tokens', cookie, { name: 'Script', scopes })
  ).json<CreatedToken>().token;
}

beforeEach(async () => {
  t = await createTestApp();
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
  const team = async (name: string, key: string, isPrivate: boolean) =>
    (
      await call('POST', `/api/admin/departments/${ids.it}/teams`, owner, { name, key, isPrivate })
    ).json<{ id: string }>().id;
  ids.help = await team('Helpdesk', 'HELP', false);
  ids.secret = await team('Security', 'SEC', true);
  for (const name of ['dev', 'boss'] as const) {
    const invite = (
      await call('POST', '/api/admin/members', owner, {
        email: `${name}@push30.test`,
        name,
        role: {
          roleId: roles.find((r) => r.key === 'member')!.id,
          scope: { type: 'team', id: ids.help },
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

describe('public REST API v1 (SPEC §10)', () => {
  it('needs a valid personal token; session cookies do not count', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    const withCookie = await t.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: people.dev.cookie },
    });
    expect(withCookie.statusCode).toBe(401);
    expect((await api('ordl_pat_wrong', 'GET', '/me')).statusCode).toBe(401);

    const read = await token(people.dev.cookie, ['read']);
    const me = await api(read, 'GET', '/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ member: { id: people.dev.id }, token: { scopes: ['read'] } });
  });

  it('enforces token scopes and the member’s own permissions', async () => {
    const read = await token(people.dev.cookie, ['read']);
    const denied = await api(read, 'POST', '/teams/HELP/issues', { title: 'Nope' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'insufficient_scope', scope: 'issues:write' });

    // The private team stays invisible, exactly as in the UI.
    expect(
      (await api(read, 'GET', '/teams')).json<Array<{ key: string }>>().map((x) => x.key),
    ).toEqual(['HELP']);
    expect((await api(read, 'GET', '/teams/SEC/issues')).statusCode).toBe(404);
  });

  it('creates, changes and comments on issues, recorded as the token', async () => {
    const write = await token(people.dev.cookie, ['read', 'issues:write']);
    const created = await api(write, 'POST', '/teams/HELP/issues', {
      title: 'From CI',
      priority: 'high',
    });
    expect(created.statusCode).toBe(201);
    const issue = created.json<IssueDetail>();
    expect(issue).toMatchObject({ identifier: 'HELP-1', priority: 'high' });

    const bad = await api(write, 'PATCH', '/issues/HELP-1', { priority: 'extreme' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'validation_failed' });

    await api(write, 'PATCH', '/issues/HELP-1', { title: 'Renamed' });
    const commented = await api(write, 'POST', '/issues/HELP-1/comments', { body: 'Built' });
    expect(commented.statusCode).toBe(201);
    const detail = (await api(write, 'GET', '/issues/HELP-1')).json<IssueDetail>();
    expect(detail.title).toBe('Renamed');
    expect(detail.comments.map((c) => c.body)).toEqual(['Built']);
    expect(detail.events.every((e) => e.viaToken === 'Script')).toBe(true);
  });

  it('pages issues with a stable cursor and filters by update time', async () => {
    const write = await token(people.dev.cookie, ['read', 'issues:write']);
    for (const n of [1, 2, 3, 4, 5]) {
      await api(write, 'POST', '/teams/HELP/issues', { title: `Issue ${n}` });
    }
    const first = (await api(write, 'GET', '/teams/HELP/issues?limit=2')).json<{
      data: IssueSummary[];
      nextCursor: string;
    }>();
    expect(first.data.map((i) => i.identifier)).toEqual(['HELP-1', 'HELP-2']);
    const second = (
      await api(write, 'GET', `/teams/HELP/issues?limit=2&cursor=${first.nextCursor}`)
    ).json<{ data: IssueSummary[]; nextCursor: string }>();
    expect(second.data.map((i) => i.identifier)).toEqual(['HELP-3', 'HELP-4']);
    const last = (
      await api(write, 'GET', `/teams/HELP/issues?limit=2&cursor=${second.nextCursor}`)
    ).json<{ data: IssueSummary[]; nextCursor: string | null }>();
    expect(last).toMatchObject({ data: [{ identifier: 'HELP-5' }], nextCursor: null });

    const future = encodeURIComponent('2999-01-01T00:00:00Z');
    expect(
      (await api(write, 'GET', `/teams/HELP/issues?updated_since=${future}`)).json<{ data: [] }>()
        .data,
    ).toEqual([]);
    expect((await api(write, 'GET', '/teams/HELP/issues?cursor=%%%')).statusCode).toBe(400);
  });

  it('replays a POST with the same Idempotency-Key instead of repeating it', async () => {
    const write = await token(people.dev.cookie, ['read', 'issues:write']);
    const headers = { 'idempotency-key': 'deploy-42' };
    const first = await api(write, 'POST', '/teams/HELP/issues', { title: 'Once' }, headers);
    const again = await api(write, 'POST', '/teams/HELP/issues', { title: 'Once' }, headers);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json<IssueDetail>().id).toBe(first.json<IssueDetail>().id);
    const list = (await api(write, 'GET', '/teams/HELP/issues')).json<{ data: IssueSummary[] }>();
    expect(list.data).toHaveLength(1);

    const other = await api(write, 'POST', '/teams/HELP/issues', { title: 'Twice' }, headers);
    expect(other.statusCode).toBe(422);
    expect(other.json()).toEqual({ error: 'idempotency_key_reused' });

    // A failed call does not burn the key.
    const failing = { 'idempotency-key': 'retry-me' };
    expect(
      (await api(write, 'POST', '/teams/HELP/issues', { title: '' }, failing)).statusCode,
    ).toBe(400);
    expect(
      (await api(write, 'POST', '/teams/HELP/issues', { title: 'Fixed' }, failing)).statusCode,
    ).toBe(201);
  });

  it('submits and reads requests; approvals stay out of reach', async () => {
    const type = (
      await call('POST', `/api/admin/departments/${ids.it}/request-types`, owner, {
        name: 'Access',
        targetTeamId: ids.help,
        fields: [],
        approvalSteps: [{ selector: { type: 'user', memberId: people.boss.id } }],
      })
    ).json<RequestTypeView>();
    const read = await token(people.dev.cookie, ['read']);
    expect(
      (await api(read, 'POST', '/requests', { requestTypeId: type.id, title: 'VPN' })).statusCode,
    ).toBe(403);

    const write = await token(people.dev.cookie, ['read', 'requests:write']);
    const submitted = await api(write, 'POST', '/requests', {
      requestTypeId: type.id,
      title: 'VPN',
    });
    expect(submitted.statusCode).toBe(201);
    const request = submitted.json<RequestView>();
    const mine = (await api(write, 'GET', '/requests')).json<{
      data: Array<{ identifier: string }>;
    }>();
    expect(mine.data.map((r) => r.identifier)).toEqual([request.identifier]);
    const commented = await api(write, 'POST', `/requests/${request.identifier}/comments`, {
      body: 'Please',
    });
    expect(commented.statusCode).toBe(201);

    // There is no approval route at all in v1.
    const boss = await token(people.boss.cookie, ['read', 'requests:write']);
    const step = request.approvals[0]!.id;
    expect(
      (await api(boss, 'POST', `/approvals/${step}/decision`, { decision: 'approve' })).statusCode,
    ).toBe(404);
  });

  it('rate limits per token', async () => {
    t.ctx.limits.api = new RateLimiter(2, 60_000);
    const a = await token(people.dev.cookie, ['read']);
    const b = await token(people.dev.cookie, ['read']);
    expect((await api(a, 'GET', '/me')).statusCode).toBe(200);
    expect((await api(a, 'GET', '/me')).statusCode).toBe(200);
    expect((await api(a, 'GET', '/me')).statusCode).toBe(429);
    expect((await api(b, 'GET', '/me')).statusCode).toBe(200);
  });

  it('publishes an OpenAPI 3.1 document without a token', async () => {
    const doc = await t.app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(doc.statusCode).toBe(200);
    const body = doc.json<{
      openapi: string;
      paths: Record<string, Record<string, { 'x-ordler-scope': string; requestBody?: unknown }>>;
    }>();
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/teams/{key}/issues']!.post!['x-ordler-scope']).toBe('issues:write');
    expect(body.paths['/teams/{key}/issues']!.post!.requestBody).toMatchObject({
      content: { 'application/json': { schema: { properties: { title: { type: 'string' } } } } },
    });
  });
});

describe('paginate', () => {
  const item = (id: string, createdAt: string) => ({ id, createdAt });

  it('keeps its place when older items are added later', () => {
    const items = [item('b', '2026-01-02'), item('a', '2026-01-01'), item('c', '2026-01-03')];
    const first = paginate(items, { limit: '1' });
    expect(first.data.map((i) => i.id)).toEqual(['a']);
    const next = paginate([item('z', '2025-12-31'), ...items], {
      limit: '5',
      cursor: first.nextCursor!,
    });
    expect(next).toEqual({ data: [items[0], items[2]], nextCursor: null });
  });
});
