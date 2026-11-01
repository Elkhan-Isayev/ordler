import { createHash } from 'node:crypto';
import { isEmailDomainAllowed } from '@ordler/shared';
import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { SecretBox } from '../crypto/secret-box.js';
import { randomToken } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import { memberIdentities } from '../db/schema.js';
import { findMemberByEmail, registerMember } from '../members/members.js';
import { DomainError } from './errors.js';
import type { FetchFn } from './google.js';
import type { Clock } from './sessions.js';
import type { AuthStrategy, StrategyService } from './strategies.js';

/** Providers resolved through OpenID Connect discovery (SPEC §8.1, Phase 2). */
export const DISCOVERED_KINDS = ['microsoft', 'oidc'] as const;
export type DiscoveredKind = (typeof DISCOVERED_KINDS)[number];

export const DEFAULT_OIDC_SCOPES = 'openid email profile';
const STATE_TTL_MS = 10 * 60_000;
const DISCOVERY_TTL_MS = 60 * 60_000;

interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface OAuthState {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
}

export interface OidcDeps {
  db: Db;
  strategies: StrategyService;
  box: SecretBox;
  baseUrl: string;
  fetch?: FetchFn;
  /** Key set for a provider's `jwks_uri`; replaced in tests. */
  jwks?: (uri: string) => JWTVerifyGetKey;
  now?: Clock;
}

export function entraIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0`;
}

/**
 * Authorization-code flow with PKCE, state and nonce for Microsoft Entra ID and any OpenID
 * Connect provider found through discovery (Keycloak, Authentik, ADFS, Okta…).
 */
export class OidcAuthService {
  private readonly fetchFn: FetchFn;
  private readonly jwksFor: (uri: string) => JWTVerifyGetKey;
  private readonly now: Clock;
  private readonly discovery = new Map<string, { metadata: ProviderMetadata; until: number }>();
  private readonly keySets = new Map<string, JWTVerifyGetKey>();

  constructor(private readonly deps: OidcDeps) {
    this.fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
    this.jwksFor = deps.jwks ?? ((uri) => createRemoteJWKSet(new URL(uri)));
    this.now = deps.now ?? (() => new Date());
  }

  redirectUri(kind: DiscoveredKind): string {
    return `${this.deps.baseUrl}/api/auth/${kind}/callback`;
  }

  async start(kind: DiscoveredKind): Promise<{ url: string; stateCookie: string }> {
    const strategy = await this.deps.strategies.requireUsable(kind);
    const metadata = await this.metadata(strategy);
    const flow: OAuthState = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(48),
      expiresAt: this.now().getTime() + STATE_TTL_MS,
    };
    const params = new URLSearchParams({
      client_id: strategy.config.clientId!,
      redirect_uri: this.redirectUri(kind),
      response_type: 'code',
      scope: scopesFor(strategy),
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    if (kind === 'microsoft') params.set('prompt', 'select_account');
    return {
      url: `${metadata.authorization_endpoint}?${params.toString()}`,
      stateCookie: this.deps.box.encrypt(JSON.stringify(flow), stateAad(kind)),
    };
  }

  /** Completes the flow and returns the member id to start a session for. */
  async callback(
    kind: DiscoveredKind,
    input: { code?: string; state?: string; stateCookie?: string },
  ): Promise<string> {
    const strategy = await this.deps.strategies.requireUsable(kind);
    const flow = this.openState(kind, input.stateCookie);
    if (!flow || !input.state || flow.state !== input.state || !input.code) {
      throw new DomainError('oauth_failed');
    }

    const payload = await this.exchange(strategy, input.code, flow);
    const claims = readClaims(strategy, payload);
    if (!claims.emailVerified) throw new DomainError('email_not_verified');

    const [identity] = await this.deps.db
      .select({ memberId: memberIdentities.memberId })
      .from(memberIdentities)
      .where(
        and(
          eq(memberIdentities.strategyKind, kind),
          eq(memberIdentities.providerSubject, claims.sub),
        ),
      );
    if (identity) return identity.memberId;

    // Link to an existing member only through a verified email (SPEC §8.1).
    const existing = await findMemberByEmail(this.deps.db, claims.email);
    let memberId: string;
    if (existing) {
      if (existing.status !== 'active') throw new DomainError('invalid_credentials');
      memberId = existing.id;
    } else {
      if (!strategy.allowSelfRegistration) throw new DomainError('registration_closed');
      if (!isEmailDomainAllowed(claims.email, strategy.allowedDomains)) {
        throw new DomainError('domain_not_allowed');
      }
      const created = await registerMember(this.deps.db, {
        email: claims.email,
        name: claims.name || claims.email.slice(0, claims.email.indexOf('@')),
        emailVerified: true,
        strategy,
      });
      memberId = created.id;
    }
    await this.deps.db
      .insert(memberIdentities)
      .values({ memberId, strategyKind: kind, providerSubject: claims.sub })
      .onConflictDoNothing();
    return memberId;
  }

  private async metadata(strategy: AuthStrategy): Promise<ProviderMetadata> {
    const issuer = expectedIssuer(strategy);
    const cached = this.discovery.get(issuer);
    if (cached && cached.until > this.now().getTime()) return cached.metadata;

    let body: Partial<ProviderMetadata>;
    try {
      const response = await this.fetchFn(`${issuer}/.well-known/openid-configuration`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new DomainError('oauth_failed');
      body = (await response.json()) as Partial<ProviderMetadata>;
    } catch {
      throw new DomainError('oauth_failed');
    }
    const metadata = body as ProviderMetadata;
    const endpoints = [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri];
    if (typeof metadata.issuer !== 'string' || !endpoints.every(isHttpsUrl)) {
      throw new DomainError('oauth_failed');
    }
    // A tenant given by domain name resolves to its GUID issuer, so only generic OIDC must match.
    if (strategy.kind === 'oidc' && trimSlash(metadata.issuer) !== issuer) {
      throw new DomainError('oauth_failed');
    }
    this.discovery.set(issuer, { metadata, until: this.now().getTime() + DISCOVERY_TTL_MS });
    return metadata;
  }

  private keySet(uri: string): JWTVerifyGetKey {
    let keys = this.keySets.get(uri);
    if (!keys) {
      keys = this.jwksFor(uri);
      this.keySets.set(uri, keys);
    }
    return keys;
  }

  private openState(kind: DiscoveredKind, sealed: string | undefined): OAuthState | undefined {
    if (!sealed) return undefined;
    const json = this.deps.box.decrypt(sealed, stateAad(kind));
    if (!json) return undefined;
    const flow = JSON.parse(json) as OAuthState;
    return flow.expiresAt > this.now().getTime() ? flow : undefined;
  }

  private async exchange(
    strategy: AuthStrategy,
    code: string,
    flow: OAuthState,
  ): Promise<JWTPayload> {
    const metadata = await this.metadata(strategy);
    const clientId = strategy.config.clientId!;
    const clientSecret = await this.deps.strategies.clientSecret(strategy.kind);
    let idToken: string | undefined;
    try {
      const response = await this.fetchFn(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret ?? '',
          redirect_uri: this.redirectUri(strategy.kind as DiscoveredKind),
          code_verifier: flow.verifier,
        }).toString(),
      });
      if (response.ok) idToken = ((await response.json()) as { id_token?: string }).id_token;
    } catch {
      throw new DomainError('oauth_failed');
    }
    if (!idToken) throw new DomainError('oauth_failed');

    try {
      const { payload } = await jwtVerify(idToken, this.keySet(metadata.jwks_uri), {
        issuer: metadata.issuer,
        audience: clientId,
        currentDate: this.now(),
      });
      if (payload.nonce !== flow.nonce || !payload.sub) throw new DomainError('oauth_failed');
      return payload;
    } catch {
      throw new DomainError('oauth_failed');
    }
  }
}

interface OidcClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
}

function readClaims(strategy: AuthStrategy, payload: JWTPayload): OidcClaims {
  const config = strategy.config;
  const emailValue =
    strategy.kind === 'microsoft'
      ? // Entra puts the address in `email` only when the user has a mailbox attribute set.
        (payload.email ?? payload.preferred_username)
      : payload[config.emailClaim ?? 'email'];
  if (typeof emailValue !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(emailValue)) {
    throw new DomainError('oauth_failed');
  }
  const nameValue = payload[strategy.kind === 'microsoft' ? 'name' : (config.nameClaim ?? 'name')];
  return {
    sub: payload.sub!,
    email: emailValue.toLowerCase(),
    // Entra is pinned to one tenant whose admins own its addresses (no self-asserted `email`
    // from other tenants); `xms_edov: false` still flags an unverified domain. Generic OIDC
    // must say `email_verified` unless the admin vouches for the provider.
    emailVerified:
      (strategy.kind === 'microsoft' && payload.xms_edov !== false) ||
      config.requireVerifiedEmail === false ||
      payload.email_verified === true,
    name: typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : undefined,
  };
}

function expectedIssuer(strategy: AuthStrategy): string {
  if (strategy.kind === 'microsoft') return entraIssuer(strategy.config.tenantId!);
  return trimSlash(strategy.config.issuerUrl!);
}

function scopesFor(strategy: AuthStrategy): string {
  const scopes = (strategy.config.scopes ?? DEFAULT_OIDC_SCOPES).split(' ');
  return scopes.includes('openid') ? scopes.join(' ') : ['openid', ...scopes].join(' ');
}

function stateAad(kind: DiscoveredKind): string {
  return `oauth_state:${kind}`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
