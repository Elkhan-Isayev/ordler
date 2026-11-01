import { createHash, randomBytes } from 'node:crypto';
import type {
  AdminRole,
  InviteResponse,
  OAuthConsentView,
  PersonalTokenView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../db/schema.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function call(
  method: 'GET' | 'POST' | 'DELETE' | 'OPTIONS' | 'PUT',
  url: string,
  options: {
    cookie?: string;
    json?: object;
    form?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
) {
  return t.app.inject({
    method,
    url,
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...options.headers,
    },
    ...(options.json ? { payload: options.json } : {}),
    ...(options.form ? { payload: new URLSearchParams(options.form).toString() } : {}),
  });
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function register(redirectUris = [REDIRECT]) {
  const response = await call('POST', '/api/oauth/register', {
    json: { client_name: 'Claude', redirect_uris: redirectUris },
    headers: { origin: 'https://claude.ai' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ client_id: string }>().client_id;
}

/** Consent as the owner and return the code from the redirect. */
async function authorize(clientId: string, challenge: string, extra: object = {}) {
  const query = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st-1',
    resource: `${TEST_BASE_URL}/mcp`,
  };
  const decision = await call('POST', '/api/oauth/consent', {
    cookie: owner,
    json: { ...query, approve: true, scopes: ['read', 'issues:write'], ...extra },
  });
  expect(decision.statusCode).toBe(200);
  return new URL(decision.json<{ redirect: string }>().redirect);
}

async function exchange(clientId: string, code: string, verifier: string) {
  return call('POST', '/api/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: `${TEST_BASE_URL}/mcp`,
    },
    headers: { origin: 'https://claude.ai' },
  });
}

async function mcpStatus(accessToken: string) {
  const response = await t.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  return response.statusCode;
}

beforeEach(async () => {
  t = await createTestApp();
  const setup = await call('POST', '/api/setup', {
    json: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
});
afterEach(() => t.close());

describe('discovery', () => {
  it('points MCP clients from the 401 to the metadata documents', async () => {
    const unauthorized = await t.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(unauthorized.headers['www-authenticate']).toContain(
      `resource_metadata="${TEST_BASE_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    const resource = await call('GET', '/.well-known/oauth-protected-resource/mcp');
    expect(resource.json()).toMatchObject({
      resource: `${TEST_BASE_URL}/mcp`,
      authorization_servers: [TEST_BASE_URL],
    });
    expect(resource.headers['access-control-allow-origin']).toBe('*');
    const server = (await call('GET', '/.well-known/oauth-authorization-server')).json();
    expect(server).toMatchObject({
      issuer: TEST_BASE_URL,
      authorization_endpoint: `${TEST_BASE_URL}/oauth/authorize`,
      token_endpoint: `${TEST_BASE_URL}/api/oauth/token`,
      registration_endpoint: `${TEST_BASE_URL}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('registers public clients and refuses dangerous redirect URIs', async () => {
    await register(['http://localhost:33418/callback', 'cursor://anysphere.cursor/oauth']);
    for (const uri of ['http://evil.test/cb', 'javascript:alert(1)', 'https://x.test/#frag']) {
      const response = await call('POST', '/api/oauth/register', {
        json: { client_name: 'Bad', redirect_uris: [uri] },
      });
      expect(response.statusCode, uri).toBe(400);
    }
    const preflight = await call('OPTIONS', '/api/oauth/token', {
      headers: { origin: 'https://claude.ai', 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(204);
  });
});

describe('authorization code flow', () => {
  it('issues tokens that act as the member on /mcp, listed as a connected app', async () => {
    const clientId = await register();
    const consent = await call(
      'GET',
      `/api/oauth/consent?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: pkce().challenge,
        code_challenge_method: 'S256',
        scope: 'read issues:write',
      })}`,
      { cookie: owner },
    );
    expect(consent.json<OAuthConsentView>()).toEqual({
      client: { id: clientId, name: 'Claude' },
      redirectHost: 'claude.ai',
      scopes: ['read', 'issues:write'],
    });

    const { verifier, challenge } = pkce();
    const redirect = await authorize(clientId, challenge);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('st-1');
    expect(redirect.searchParams.get('iss')).toBe(TEST_BASE_URL);

    const tokenResponse = await exchange(clientId, redirect.searchParams.get('code')!, verifier);
    expect(tokenResponse.statusCode).toBe(200);
    expect(tokenResponse.headers['cache-control']).toBe('no-store');
    const tokens = tokenResponse.json<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    }>();
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read issues:write',
    });
    expect(await mcpStatus(tokens.access_token)).toBe(200);

    const listed = (await call('GET', '/api/me/tokens', { cookie: owner })).json<{
      tokens: PersonalTokenView[];
    }>().tokens;
    expect(listed[0]).toMatchObject({
      app: 'Claude',
      name: 'Claude',
      scopes: ['read', 'issues:write'],
    });
    const audit = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'oauth_grant.created'));
    expect(JSON.stringify(audit)).not.toContain(tokens.access_token);

    // Revoking in Settings → Access tokens cuts the client off, refresh included.
    await call('DELETE', `/api/me/tokens/${listed[0]!.id}`, { cookie: owner });
    expect(await mcpStatus(tokens.access_token)).toBe(401);
    const refreshed = await call('POST', '/api/oauth/token', {
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refresh_token,
      },
    });
    expect(refreshed.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rotates refresh tokens and retires the previous pair', async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const redirect = await authorize(clientId, challenge);
    const first = (await exchange(clientId, redirect.searchParams.get('code')!, verifier)).json<{
      access_token: string;
      refresh_token: string;
    }>();
    const second = await call('POST', '/api/oauth/token', {
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: first.refresh_token,
      },
    });
    const next = second.json<{ access_token: string; refresh_token: string }>();
    expect(next.refresh_token).not.toBe(first.refresh_token);
    expect(await mcpStatus(first.access_token)).toBe(401);
    expect(await mcpStatus(next.access_token)).toBe(200);
    const reused = await call('POST', '/api/oauth/token', {
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: first.refresh_token,
      },
    });
    expect(reused.statusCode).toBe(400);
    const otherClient = await call('POST', '/api/oauth/token', {
      form: {
        grant_type: 'refresh_token',
        client_id: 'oc_other',
        refresh_token: next.refresh_token,
      },
    });
    expect(otherClient.statusCode).toBe(400);
  });

  it('refuses a wrong verifier and revokes the grant when a code is replayed', async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    let redirect = await authorize(clientId, challenge);
    const wrong = await exchange(clientId, redirect.searchParams.get('code')!, pkce().verifier);
    expect(wrong.json()).toEqual({ error: 'invalid_grant' });

    redirect = await authorize(clientId, challenge);
    const code = redirect.searchParams.get('code')!;
    const tokens = (await exchange(clientId, code, verifier)).json<{ access_token: string }>();
    expect(await mcpStatus(tokens.access_token)).toBe(200);
    const replay = await exchange(clientId, code, verifier);
    expect(replay.statusCode).toBe(400);
    expect(await mcpStatus(tokens.access_token)).toBe(401);
  });

  it('sends a denial back to the client without a code', async () => {
    const clientId = await register();
    const redirect = await authorize(clientId, pkce().challenge, { approve: false });
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('code')).toBeNull();
  });

  it('refuses unknown redirect URIs, other resources and a disabled MCP server', async () => {
    const clientId = await register();
    const base = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'https://evil.test/cb',
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
    };
    expect(
      (await call('GET', `/api/oauth/consent?${new URLSearchParams(base)}`, { cookie: owner }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          'GET',
          `/api/oauth/consent?${new URLSearchParams({ ...base, redirect_uri: REDIRECT, resource: 'https://other.test/mcp' })}`,
          { cookie: owner },
        )
      ).statusCode,
    ).toBe(400);

    await call('PUT', '/api/admin/tokens/settings', {
      cookie: owner,
      json: { mcpEnabled: false, maxExpiryDays: 365, allowNoExpiry: false },
    });
    expect(
      (
        await call(
          'GET',
          `/api/oauth/consent?${new URLSearchParams({ ...base, redirect_uri: REDIRECT })}`,
          {
            cookie: owner,
          },
        )
      ).statusCode,
    ).toBe(403);
  });

  it('lets only members who may use MCP grant access', async () => {
    const roles = (await call('GET', '/api/admin/roles', { cookie: owner })).json<AdminRole[]>();
    const guest = roles.find((role) => role.key === 'guest')!;
    const invite = (
      await call('POST', '/api/admin/members', {
        cookie: owner,
        json: {
          email: 'guest@push30.test',
          name: 'Guest',
          role: { roleId: guest.id, scope: { type: 'organization' } },
        },
      })
    ).json<InviteResponse>();
    const accepted = await call('POST', '/api/invites/accept', {
      json: {
        token: invite.inviteUrl.split('/invite/')[1],
        name: 'Guest',
        password: 'guest-password-1',
      },
    });
    const guestCookie = cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE);
    const clientId = await register();
    const response = await call(
      'GET',
      `/api/oauth/consent?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: pkce().challenge,
        code_challenge_method: 'S256',
      })}`,
      { cookie: guestCookie },
    );
    expect(response.statusCode).toBe(403);
    // Without a session the consent API answers 401 and the page shows sign-in.
    expect((await call('GET', `/api/oauth/consent?client_id=${clientId}`)).statusCode).toBe(401);
  });
});
