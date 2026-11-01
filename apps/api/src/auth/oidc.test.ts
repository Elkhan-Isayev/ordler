import { eq } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { memberIdentities, members } from '../db/schema.js';
import { systemRoleId } from '../setup/system-roles.js';
import { completeSetup, OWNER, strategiesFor, testBox, testClock } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import type { FetchFn } from './google.js';
import { entraIssuer, OidcAuthService, type DiscoveredKind } from './oidc.js';
import type { StrategyService } from './strategies.js';

const CLIENT_ID = 'ordler-client';
const TENANT = '11111111-2222-3333-4444-555555555555';
const OIDC_ISSUER = 'https://sso.company.test/realms/main';

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
let requests: string[];
let nextClaims: JWTPayload;
let discoveredIssuer: string | undefined;

const actor = () => ({ type: 'member' as const, id: ownerId });

function issuerFor(kind: DiscoveredKind): string {
  return kind === 'microsoft' ? entraIssuer(TENANT) : OIDC_ISSUER;
}

/** Fake provider: discovery document, token endpoint returning an ID token with `nextClaims`. */
function fakeProvider(kind: DiscoveredKind): FetchFn {
  const issuer = issuerFor(kind);
  return async (url, init) => {
    requests.push(url);
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: discoveredIssuer ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/keys`,
      });
    }
    if (url === `${issuer}/token`) {
      const body = new URLSearchParams(String(init.body));
      if (body.get('code') === 'bad-code') return new Response('{}', { status: 400 });
      const now = Math.floor(clock.now().getTime() / 1000);
      const idToken = await new SignJWT(nextClaims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience(CLIENT_ID)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(keys.privateKey);
      return Response.json({ id_token: idToken });
    }
    return new Response('not found', { status: 404 });
  };
}

function service(kind: DiscoveredKind) {
  return new OidcAuthService({
    db,
    strategies,
    box,
    baseUrl: 'https://ordler.test',
    fetch: fakeProvider(kind),
    jwks: () => jwks,
    now: clock.now,
  });
}

async function signInWith(kind: DiscoveredKind, claims: JWTPayload, code = 'auth-code') {
  const oidc = service(kind);
  const { url, stateCookie } = await oidc.start(kind);
  const params = new URL(url).searchParams;
  nextClaims = { nonce: params.get('nonce')!, ...claims };
  return oidc.callback(kind, { code, state: params.get('state')!, stateCookie });
}

async function configure(kind: DiscoveredKind, config: Record<string, unknown> = {}) {
  await strategies.update(
    kind,
    {
      enabled: true,
      config: {
        clientId: CLIENT_ID,
        ...(kind === 'microsoft' ? { tenantId: TENANT } : { issuerUrl: OIDC_ISSUER }),
        ...config,
      },
      secrets: { clientSecret: 'provider-secret' },
      allowSelfRegistration: true,
      allowedDomains: ['company.com'],
      defaultRoleId: (await systemRoleId(db, 'member'))!,
    },
    actor(),
    'local',
  );
}

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
  box = testBox();
  clock = testClock();
  requests = [];
  discoveredIssuer = undefined;
  strategies = await strategiesFor(db, { box });
});
afterEach(() => test.close());

describe('strategy settings', () => {
  it('cannot be enabled until the provider is fully configured', async () => {
    await expect(
      strategies.update(
        'microsoft',
        { enabled: true, config: { clientId: CLIENT_ID }, secrets: { clientSecret: 's' } },
        actor(),
        'local',
      ),
    ).rejects.toMatchObject({ code: 'strategy_disabled' });
    await configure('microsoft');
    expect((await strategies.get('microsoft'))?.enabled).toBe(true);
  });
});

describe('Microsoft Entra ID', () => {
  beforeEach(() => configure('microsoft'));

  it('discovers the tenant endpoints and redirects with PKCE', async () => {
    const { url } = await service('microsoft').start('microsoft');
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${entraIssuer(TENANT)}/authorize`);
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://ordler.test/api/auth/microsoft/callback',
    );
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
  });

  it('registers a member from preferred_username when the email claim is missing', async () => {
    const memberId = await signInWith('microsoft', {
      sub: 'entra-1',
      preferred_username: 'Ana@Company.com',
      name: 'Ana Lima',
    });
    const [member] = await db.select().from(members).where(eq(members.id, memberId));
    expect(member).toMatchObject({ email: 'ana@company.com', name: 'Ana Lima' });
    const [identity] = await db
      .select()
      .from(memberIdentities)
      .where(eq(memberIdentities.memberId, memberId));
    expect(identity).toMatchObject({ strategyKind: 'microsoft', providerSubject: 'entra-1' });
  });

  it('rejects an address Entra marks as not domain-verified', async () => {
    await expect(
      signInWith('microsoft', { sub: 'entra-2', email: OWNER.email, xms_edov: false }),
    ).rejects.toMatchObject({ code: 'email_not_verified' });
  });

  it('rejects a token signed for another issuer', async () => {
    discoveredIssuer = 'https://login.microsoftonline.com/other-tenant/v2.0';
    await expect(
      signInWith('microsoft', { sub: 'entra-3', email: 'bo@company.com' }),
    ).rejects.toMatchObject({ code: 'oauth_failed' });
  });
});

describe('generic OIDC', () => {
  beforeEach(() => configure('oidc', { scopes: 'email profile groups' }));

  it('links an existing member through a verified email and remembers the subject', async () => {
    const memberId = await signInWith('oidc', {
      sub: 'kc-1',
      email: OWNER.email,
      email_verified: true,
    });
    expect(memberId).toBe(ownerId);
    // Second sign-in is matched by subject even if the address changed at the provider.
    const again = await signInWith('oidc', {
      sub: 'kc-1',
      email: 'renamed@company.com',
      email_verified: true,
    });
    expect(again).toBe(ownerId);
  });

  it('always asks for the openid scope', async () => {
    const { url } = await service('oidc').start('oidc');
    expect(new URL(url).searchParams.get('scope')).toBe('openid email profile groups');
  });

  it('rejects an unverified email unless the admin vouches for the provider', async () => {
    const claims = { sub: 'kc-2', email: OWNER.email };
    await expect(signInWith('oidc', claims)).rejects.toMatchObject({
      code: 'email_not_verified',
    });
    await configure('oidc', { requireVerifiedEmail: false });
    expect(await signInWith('oidc', claims)).toBe(ownerId);
  });

  it('reads email and name from mapped claims', async () => {
    await configure('oidc', { emailClaim: 'upn', nameClaim: 'display_name' });
    const memberId = await signInWith('oidc', {
      sub: 'kc-3',
      upn: 'li@company.com',
      display_name: 'Li Wei',
      email_verified: true,
    });
    const [member] = await db.select().from(members).where(eq(members.id, memberId));
    expect(member).toMatchObject({ email: 'li@company.com', name: 'Li Wei' });
  });

  it('refuses discovery documents for a different issuer', async () => {
    discoveredIssuer = 'https://evil.test';
    await expect(service('oidc').start('oidc')).rejects.toMatchObject({ code: 'oauth_failed' });
  });

  it('applies self-registration rules', async () => {
    await expect(
      signInWith('oidc', { sub: 'kc-4', email: 'x@other.com', email_verified: true }),
    ).rejects.toMatchObject({ code: 'domain_not_allowed' });
    await strategies.update('oidc', { allowSelfRegistration: false }, actor(), 'local');
    await expect(
      signInWith('oidc', { sub: 'kc-5', email: 'new@company.com', email_verified: true }),
    ).rejects.toMatchObject({ code: 'registration_closed' });
  });

  it('fails on a rejected code, a wrong state or a wrong nonce', async () => {
    await expect(
      signInWith('oidc', { sub: 'kc-6', email: OWNER.email, email_verified: true }, 'bad-code'),
    ).rejects.toMatchObject({ code: 'oauth_failed' });

    const oidc = service('oidc');
    const { url, stateCookie } = await oidc.start('oidc');
    nextClaims = { sub: 'kc-6', email: OWNER.email, email_verified: true, nonce: 'other' };
    const state = new URL(url).searchParams.get('state')!;
    await expect(
      oidc.callback('oidc', { code: 'c', state: 'forged', stateCookie }),
    ).rejects.toMatchObject({ code: 'oauth_failed' });
    await expect(oidc.callback('oidc', { code: 'c', state, stateCookie })).rejects.toMatchObject({
      code: 'oauth_failed',
    });
  });

  it('does not accept a state cookie sealed for Microsoft', async () => {
    await configure('microsoft');
    const { url, stateCookie } = await service('microsoft').start('microsoft');
    const state = new URL(url).searchParams.get('state')!;
    await expect(
      service('oidc').callback('oidc', { code: 'c', state, stateCookie }),
    ).rejects.toMatchObject({ code: 'oauth_failed' });
  });

  it('caches discovery between sign-ins', async () => {
    const oidc = service('oidc');
    await oidc.start('oidc');
    await oidc.start('oidc');
    expect(requests.filter((url) => url.endsWith('openid-configuration'))).toHaveLength(1);
  });
});
