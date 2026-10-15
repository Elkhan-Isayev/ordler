import { eq } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { memberIdentities, members } from '../db/schema.js';
import { systemRoleId } from '../setup/system-roles.js';
import { completeSetup, OWNER, strategiesFor, testBox, testClock } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { GOOGLE_ENDPOINTS, GoogleAuthService, type FetchFn } from './google.js';
import type { StrategyService } from './strategies.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256' }],
  });
});

let test: TestDatabase;
let db: Db;
let ownerId: string;
let box: SecretBox;
let strategies: StrategyService;
let clock: ReturnType<typeof testClock>;
let tokenRequests: URLSearchParams[];
let nextClaims: JWTPayload;

const actor = () => ({ type: 'member' as const, id: ownerId });

async function idToken(claims: JWTPayload): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(CLIENT_ID)
    .setIssuedAt(Math.floor(clock.now().getTime() / 1000))
    .setExpirationTime(Math.floor(clock.now().getTime() / 1000) + 3600)
    .sign(keys.privateKey);
}

/** Fake Google token endpoint returning an ID token with `nextClaims` plus the flow's nonce. */
const fakeFetch: FetchFn = async (url, init) => {
  expect(url).toBe(GOOGLE_ENDPOINTS.token);
  const body = new URLSearchParams(String(init.body));
  tokenRequests.push(body);
  if (body.get('code') === 'bad-code') return new Response('{}', { status: 400 });
  return Response.json({ id_token: await idToken(nextClaims) });
};

function service() {
  return new GoogleAuthService({
    db,
    strategies,
    box,
    baseUrl: 'https://ordler.test',
    fetch: fakeFetch,
    jwks,
    now: clock.now,
  });
}

/** Runs start(), then the callback with the nonce Google would echo back. */
async function signInWith(claims: JWTPayload, overrides: { code?: string; state?: string } = {}) {
  const google = service();
  const { url, stateCookie } = await google.start();
  const params = new URL(url).searchParams;
  nextClaims = { nonce: params.get('nonce')!, ...claims };
  return google.callback({
    code: overrides.code ?? 'auth-code',
    state: overrides.state ?? params.get('state')!,
    stateCookie,
  });
}

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
  box = testBox();
  clock = testClock();
  tokenRequests = [];
  strategies = await strategiesFor(db, { box });
  await strategies.update(
    'google',
    {
      enabled: true,
      config: { clientId: CLIENT_ID },
      secrets: { clientSecret: 'google-secret' },
      allowSelfRegistration: true,
      allowedDomains: ['company.com'],
      defaultRoleId: (await systemRoleId(db, 'member'))!,
    },
    actor(),
    'local',
  );
});
afterEach(() => test.close());

describe('GoogleAuthService.start', () => {
  it('builds an authorization URL with PKCE, state and nonce', async () => {
    const { url, stateCookie } = await service().start();
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(GOOGLE_ENDPOINTS.authorize);
    expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://ordler.test/api/auth/google/callback',
    );
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBeTruthy();
    expect(stateCookie).not.toContain(parsed.searchParams.get('state')!);
  });

  it('passes the hosted domain hint when configured', async () => {
    await strategies.update(
      'google',
      { config: { hostedDomain: 'company.com' } },
      actor(),
      'local',
    );
    const { url } = await service().start();
    expect(new URL(url).searchParams.get('hd')).toBe('company.com');
  });

  it('fails when Google sign-in is disabled', async () => {
    await strategies.update('google', { enabled: false }, actor(), 'local');
    await expect(service().start()).rejects.toMatchObject({ code: 'strategy_disabled' });
  });
});

describe('GoogleAuthService.callback', () => {
  const ann = {
    sub: 'google-ann',
    email: 'ann@company.com',
    email_verified: true,
    name: 'Ann Lee',
  };

  it('self-registers an allowed domain with the default role (MVP acceptance criterion 7)', async () => {
    const memberId = await signInWith(ann);
    const [member] = await db.select().from(members).where(eq(members.id, memberId));
    expect(member).toMatchObject({ email: 'ann@company.com', name: 'Ann Lee', status: 'active' });
    const [identity] = await db.select().from(memberIdentities);
    expect(identity).toMatchObject({
      memberId,
      strategyKind: 'google',
      providerSubject: 'google-ann',
    });
    expect(tokenRequests[0]!.get('client_secret')).toBe('google-secret');
    expect(tokenRequests[0]!.get('code_verifier')).toBeTruthy();
  });

  it('refuses other domains (MVP acceptance criterion 7)', async () => {
    await expect(
      signInWith({ sub: 'g-2', email: 'someone@gmail.com', email_verified: true }),
    ).rejects.toMatchObject({ code: 'domain_not_allowed' });
    expect(await db.select().from(members)).toHaveLength(1);
  });

  it('refuses unknown users when self-registration is closed', async () => {
    await strategies.update('google', { allowSelfRegistration: false }, actor(), 'local');
    await expect(signInWith(ann)).rejects.toMatchObject({ code: 'registration_closed' });
  });

  it('returns the same member on the next sign-in', async () => {
    const first = await signInWith(ann);
    expect(await signInWith(ann)).toBe(first);
    expect(await db.select().from(members)).toHaveLength(2);
  });

  it('links an existing member by verified email', async () => {
    const memberId = await signInWith({ sub: 'g-owner', email: OWNER.email, email_verified: true });
    expect(memberId).toBe(ownerId);
  });

  it('refuses unverified emails', async () => {
    await expect(signInWith({ ...ann, email_verified: false })).rejects.toMatchObject({
      code: 'email_not_verified',
    });
  });

  it('enforces the hosted domain claim', async () => {
    await strategies.update(
      'google',
      { config: { hostedDomain: 'company.com' } },
      actor(),
      'local',
    );
    await expect(signInWith(ann)).rejects.toMatchObject({ code: 'domain_not_allowed' });
    expect(await signInWith({ ...ann, hd: 'company.com' })).toBeTruthy();
  });

  it('rejects a mismatched state', async () => {
    await expect(signInWith(ann, { state: 'forged' })).rejects.toMatchObject({
      code: 'oauth_failed',
    });
  });

  it('rejects a missing or tampered state cookie', async () => {
    const google = service();
    const { url } = await google.start();
    const state = new URL(url).searchParams.get('state')!;
    await expect(google.callback({ code: 'c', state })).rejects.toMatchObject({
      code: 'oauth_failed',
    });
    await expect(
      google.callback({ code: 'c', state, stateCookie: 'v1.a.b.c' }),
    ).rejects.toMatchObject({ code: 'oauth_failed' });
  });

  it('rejects an expired flow', async () => {
    const google = service();
    const { url, stateCookie } = await google.start();
    clock.advance(10 * 60_000 + 1);
    await expect(
      google.callback({ code: 'c', state: new URL(url).searchParams.get('state')!, stateCookie }),
    ).rejects.toMatchObject({ code: 'oauth_failed' });
  });

  it('rejects a wrong nonce', async () => {
    const google = service();
    const { url, stateCookie } = await google.start();
    nextClaims = { ...ann, nonce: 'replayed-nonce' };
    await expect(
      google.callback({ code: 'c', state: new URL(url).searchParams.get('state')!, stateCookie }),
    ).rejects.toMatchObject({ code: 'oauth_failed' });
  });

  it('rejects a failed code exchange', async () => {
    await expect(signInWith(ann, { code: 'bad-code' })).rejects.toMatchObject({
      code: 'oauth_failed',
    });
  });

  it('rejects tokens signed by someone else', async () => {
    const google = new GoogleAuthService({
      db,
      strategies,
      box,
      baseUrl: 'https://ordler.test',
      fetch: async () => {
        const other = await generateKeyPair('RS256');
        const forged = await new SignJWT({ ...ann })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer('https://accounts.google.com')
          .setAudience(CLIENT_ID)
          .setExpirationTime('1h')
          .sign(other.privateKey);
        return Response.json({ id_token: forged });
      },
      jwks,
      now: clock.now,
    });
    const { url, stateCookie } = await google.start();
    await expect(
      google.callback({ code: 'c', state: new URL(url).searchParams.get('state')!, stateCookie }),
    ).rejects.toMatchObject({ code: 'oauth_failed' });
  });
});
