import { createHash } from 'node:crypto';
import { isEmailDomainAllowed } from '@ordler/shared';
import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { SecretBox } from '../crypto/secret-box.js';
import { randomToken } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import { memberIdentities } from '../db/schema.js';
import { findMemberByEmail, registerMember } from '../members/members.js';
import { DomainError } from './errors.js';
import type { Clock } from './sessions.js';
import type { StrategyService } from './strategies.js';

export const OAUTH_STATE_COOKIE = 'ordler_oauth';
const STATE_TTL_MS = 10 * 60_000;
const STATE_AAD = 'oauth_state:google';

export const GOOGLE_ENDPOINTS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  hostedDomain?: string;
}

interface OAuthState {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface GoogleDeps {
  db: Db;
  strategies: StrategyService;
  box: SecretBox;
  baseUrl: string;
  fetch?: FetchFn;
  jwks?: JWTVerifyGetKey;
  now?: Clock;
}

/** OpenID Connect authorization-code flow with PKCE, state and nonce (SPEC §8.1). */
export class GoogleAuthService {
  private readonly fetchFn: FetchFn;
  private readonly jwks: JWTVerifyGetKey;
  private readonly now: Clock;

  constructor(private readonly deps: GoogleDeps) {
    this.fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
    this.jwks = deps.jwks ?? createRemoteJWKSet(new URL(GOOGLE_ENDPOINTS.jwks));
    this.now = deps.now ?? (() => new Date());
  }

  get redirectUri(): string {
    return `${this.deps.baseUrl}/api/auth/google/callback`;
  }

  /** Returns the Google URL to redirect to and the sealed state to keep in a cookie. */
  async start(): Promise<{ url: string; stateCookie: string }> {
    const strategy = await this.deps.strategies.requireUsable('google');
    const flow: OAuthState = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(48),
      expiresAt: this.now().getTime() + STATE_TTL_MS,
    };
    const params = new URLSearchParams({
      client_id: strategy.config.clientId!,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    if (strategy.config.hostedDomain) params.set('hd', strategy.config.hostedDomain);
    return {
      url: `${GOOGLE_ENDPOINTS.authorize}?${params.toString()}`,
      stateCookie: this.deps.box.encrypt(JSON.stringify(flow), STATE_AAD),
    };
  }

  /** Completes the flow and returns the member id to start a session for. */
  async callback(input: { code?: string; state?: string; stateCookie?: string }): Promise<string> {
    const strategy = await this.deps.strategies.requireUsable('google');
    const flow = this.openState(input.stateCookie);
    if (!flow || !input.state || flow.state !== input.state || !input.code) {
      throw new DomainError('oauth_failed');
    }

    const claims = await this.exchange(input.code, flow, strategy.config.clientId!);
    if (!claims.emailVerified) throw new DomainError('email_not_verified');
    const email = claims.email.toLowerCase();
    if (strategy.config.hostedDomain && claims.hostedDomain !== strategy.config.hostedDomain) {
      throw new DomainError('domain_not_allowed');
    }

    const [identity] = await this.deps.db
      .select({ memberId: memberIdentities.memberId })
      .from(memberIdentities)
      .where(
        and(
          eq(memberIdentities.strategyKind, 'google'),
          eq(memberIdentities.providerSubject, claims.sub),
        ),
      );
    if (identity) return identity.memberId;

    // Link to an existing member only through a verified email (SPEC §8.1).
    const existing = await findMemberByEmail(this.deps.db, email);
    let memberId: string;
    if (existing) {
      if (existing.status !== 'active') throw new DomainError('invalid_credentials');
      memberId = existing.id;
    } else {
      if (!strategy.allowSelfRegistration) throw new DomainError('registration_closed');
      if (!isEmailDomainAllowed(email, strategy.allowedDomains)) {
        throw new DomainError('domain_not_allowed');
      }
      const created = await registerMember(this.deps.db, {
        email,
        name: claims.name?.trim() || email.slice(0, email.indexOf('@')),
        emailVerified: true,
        strategy,
      });
      memberId = created.id;
    }
    await this.deps.db
      .insert(memberIdentities)
      .values({ memberId, strategyKind: 'google', providerSubject: claims.sub })
      .onConflictDoNothing();
    return memberId;
  }

  private openState(sealed: string | undefined): OAuthState | undefined {
    if (!sealed) return undefined;
    const json = this.deps.box.decrypt(sealed, STATE_AAD);
    if (!json) return undefined;
    const flow = JSON.parse(json) as OAuthState;
    return flow.expiresAt > this.now().getTime() ? flow : undefined;
  }

  private async exchange(code: string, flow: OAuthState, clientId: string): Promise<GoogleClaims> {
    const clientSecret = await this.deps.strategies.clientSecret('google');
    const response = await this.fetchFn(GOOGLE_ENDPOINTS.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret ?? '',
        redirect_uri: this.redirectUri,
        code_verifier: flow.verifier,
      }).toString(),
    });
    if (!response.ok) throw new DomainError('oauth_failed');
    const body = (await response.json()) as { id_token?: string };
    if (!body.id_token) throw new DomainError('oauth_failed');

    try {
      const { payload } = await jwtVerify(body.id_token, this.jwks, {
        issuer: GOOGLE_ENDPOINTS.issuers,
        audience: clientId,
        currentDate: this.now(),
      });
      if (payload.nonce !== flow.nonce || typeof payload.email !== 'string' || !payload.sub) {
        throw new DomainError('oauth_failed');
      }
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
        ...(typeof payload.hd === 'string' ? { hostedDomain: payload.hd } : {}),
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('oauth_failed');
    }
  }
}
