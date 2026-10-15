import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from './sessions.js';
import { OWNER } from '../test/fixtures.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { members, roleAssignments } from '../db/schema.js';
import { systemRoleId } from '../setup/system-roles.js';

let t: TestApp;

const SETUP_BODY = {
  companyName: 'Push30',
  defaultLocale: 'ru',
  owner: { name: OWNER.name, email: OWNER.email, password: OWNER.password },
};

async function inject(options: {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  payload?: unknown;
  cookie?: string;
  origin?: string;
}) {
  return t.app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
  });
}

async function setupOwner(): Promise<string> {
  const response = await inject({ method: 'POST', url: '/api/setup', payload: SETUP_BODY });
  expect(response.statusCode).toBe(201);
  return cookieFrom(response.headers['set-cookie'], SESSION_COOKIE);
}

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('setup wizard', () => {
  it('reports that setup is required, completes it and signs the Owner in', async () => {
    expect((await inject({ method: 'GET', url: '/api/setup/status' })).json()).toEqual({
      setupRequired: true,
    });
    const response = await inject({ method: 'POST', url: '/api/setup', payload: SETUP_BODY });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      member: { name: OWNER.name, email: OWNER.email },
      workspace: { companyName: 'Push30', defaultLocale: 'ru' },
      departments: [],
    });
    const cookie = response.headers['set-cookie'] as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect((await inject({ method: 'GET', url: '/api/setup/status' })).json()).toEqual({
      setupRequired: false,
    });
  });

  it('cannot run twice', async () => {
    await setupOwner();
    const again = await inject({ method: 'POST', url: '/api/setup', payload: SETUP_BODY });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'setup_completed' });
  });

  it('validates the payload', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...SETUP_BODY, owner: { ...SETUP_BODY.owner, password: 'short' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_failed',
      issues: [{ path: 'owner.password', message: 'password_too_short' }],
    });
  });
});

describe('sessions and /api/me', () => {
  it('requires a session', async () => {
    expect((await inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const bogus = await inject({ method: 'GET', url: '/api/me', cookie: `${SESSION_COOKIE}=nope` });
    expect(bogus.statusCode).toBe(401);
  });

  it('returns the signed-in member and ends on sign-out', async () => {
    const cookie = await setupOwner();
    expect((await inject({ method: 'GET', url: '/api/me', cookie })).statusCode).toBe(200);
    const out = await inject({ method: 'POST', url: '/api/auth/sign-out', cookie });
    expect(out.statusCode).toBe(204);
    expect(out.headers['set-cookie']).toContain('Max-Age=0');
    expect((await inject({ method: 'GET', url: '/api/me', cookie })).statusCode).toBe(401);
  });
});

describe('password sign-in', () => {
  beforeEach(setupOwner);

  it('lists only usable strategies', async () => {
    expect((await inject({ method: 'GET', url: '/api/auth/strategies' })).json()).toEqual([
      { kind: 'local', displayName: null },
    ]);
  });

  it('signs in and sets a session cookie', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { email: OWNER.email, password: OWNER.password },
    });
    expect(response.statusCode).toBe(200);
    const cookie = cookieFrom(response.headers['set-cookie'], SESSION_COOKIE);
    expect((await inject({ method: 'GET', url: '/api/me', cookie })).statusCode).toBe(200);
  });

  it('rejects wrong passwords with a generic error', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { email: OWNER.email, password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('rate-limits repeated attempts', async () => {
    const attempt = () =>
      inject({
        method: 'POST',
        url: '/api/auth/password',
        payload: { email: OWNER.email, password: 'wrong-password' },
      });
    for (let i = 0; i < 10; i += 1) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: 'rate_limited' });
  });

  it('rejects cross-site form posts', async () => {
    const response = await inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { email: OWNER.email, password: OWNER.password },
      origin: 'https://evil.example',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden_origin' });
    const sameOrigin = await inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { email: OWNER.email, password: OWNER.password },
      origin: TEST_BASE_URL,
    });
    expect(sameOrigin.statusCode).toBe(200);
  });
});

describe('email OTP over HTTP', () => {
  it('requests and verifies a code', async () => {
    const ownerCookie = await setupOwner();
    const enable = await inject({
      method: 'PATCH',
      url: '/api/admin/auth/strategies/email_otp',
      payload: { enabled: true },
      cookie: ownerCookie,
    });
    expect(enable.statusCode).toBe(200);

    const requested = await inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      payload: { email: OWNER.email },
    });
    expect(requested.statusCode).toBe(202);
    const code = /(\d{6})/.exec(t.mailer.sent[0]!.subject)![1]!;
    expect(t.mailer.sent[0]!.subject).toContain('код входа');

    const unknown = await inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      payload: { email: 'nobody@push30.test' },
    });
    expect(unknown.statusCode).toBe(202);
    expect(t.mailer.sent).toHaveLength(1);

    const verified = await inject({
      method: 'POST',
      url: '/api/auth/otp/verify',
      payload: { email: OWNER.email, code },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.headers['set-cookie']).toContain(`${SESSION_COOKIE}=`);
  });

  it('is refused while the strategy is disabled', async () => {
    await setupOwner();
    const response = await inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      payload: { email: OWNER.email },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'strategy_disabled' });
  });
});

describe('admin authentication settings', () => {
  it('lists strategies without secret values', async () => {
    const cookie = await setupOwner();
    await inject({
      method: 'PATCH',
      url: '/api/admin/auth/strategies/google',
      payload: { config: { clientId: 'cid' }, secrets: { clientSecret: 'very-secret' } },
      cookie,
    });
    const response = await inject({ method: 'GET', url: '/api/admin/auth/strategies', cookie });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('very-secret');
    expect(response.json()).toContainEqual(
      expect.objectContaining({
        kind: 'google',
        hasClientSecret: true,
        callbackUrl: `${TEST_BASE_URL}/api/auth/google/callback`,
      }),
    );
  });

  it('forbids members without auth.manage', async () => {
    await setupOwner();
    const [member] = await t.database.db
      .insert(members)
      .values({ email: 'member@push30.test', name: 'Member', status: 'active' })
      .returning({ id: members.id });
    await t.database.db.insert(roleAssignments).values({
      memberId: member!.id,
      roleId: (await systemRoleId(t.database.db, 'member'))!,
      scopeType: 'organization',
      scopeId: null,
    });
    const { token } = await t.ctx.sessions.create(member!.id, 'local');
    const cookie = `${SESSION_COOKIE}=${token}`;
    expect(
      (await inject({ method: 'GET', url: '/api/admin/auth/strategies', cookie })).statusCode,
    ).toBe(403);
    expect(
      (
        await inject({
          method: 'PATCH',
          url: '/api/admin/auth/strategies/local',
          payload: { enabled: false },
          cookie,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('refuses to lock the admin out', async () => {
    const cookie = await setupOwner();
    const response = await inject({
      method: 'PATCH',
      url: '/api/admin/auth/strategies/local',
      payload: { enabled: false },
      cookie,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'lockout_prevented' });
  });

  it('returns 404 for unknown strategies', async () => {
    const cookie = await setupOwner();
    expect(
      (
        await inject({
          method: 'PATCH',
          url: '/api/admin/auth/strategies/ldap',
          payload: {},
          cookie,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('Google sign-in redirects', () => {
  it('redirects to Google with a state cookie', async () => {
    const cookie = await setupOwner();
    await inject({
      method: 'PATCH',
      url: '/api/admin/auth/strategies/google',
      payload: { enabled: true, config: { clientId: 'cid' }, secrets: { clientSecret: 's' } },
      cookie,
    });
    const response = await inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(response.headers['set-cookie']).toContain('Path=/api/auth/google');
  });

  it('sends errors back to the sign-in page', async () => {
    await setupOwner();
    const start = await inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toBe(`${TEST_BASE_URL}/?auth_error=strategy_disabled`);
  });
});
