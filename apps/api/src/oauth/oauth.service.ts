import { createHash } from 'node:crypto';
import {
  oauthClientRegistrationSchema,
  parseOAuthScopes,
  TOKEN_SCOPES,
  type OAuthAuthorizeQuery,
  type OAuthConsentView,
  type TokenScope,
} from '@ordler/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { DomainError } from '../auth/errors.js';
import { randomToken, sha256 } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import { oauthClients, oauthCodes } from '../db/schema.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';
import { holdsAnywhere, type OAuthTokens, type TokenService } from '../tokens/token.service.js';

const CODE_TTL_MS = 5 * 60_000;
/** Schemes a malicious client could use to run code in the member's browser. */
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface OAuthServiceDeps {
  db: Db;
  tokens: TokenService;
  access: AccessContextSource;
  baseUrl: string;
  now?: () => Date;
}

/** RFC 6749 error answer of the token endpoint. */
export class OAuthError extends Error {
  constructor(
    readonly error:
      | 'invalid_request'
      | 'invalid_grant'
      | 'invalid_client'
      | 'unsupported_grant_type'
      | 'invalid_client_metadata'
      | 'invalid_redirect_uri',
    readonly status = 400,
  ) {
    super(error);
  }
}

/**
 * OAuth 2.1 authorization server for MCP clients (SPEC §10.1, MCP authorization): protected
 * resource and server metadata, dynamic client registration, consent in Ordler, PKCE-bound
 * codes and rotating refresh tokens. Grants act exactly as the member with the chosen scopes.
 */
export class OAuthService {
  constructor(private readonly deps: OAuthServiceDeps) {}

  /** The MCP endpoint is the only protected resource; tokens name it as their audience. */
  get resource(): string {
    return `${this.deps.baseUrl}/mcp`;
  }

  get resourceMetadataUrl(): string {
    return `${this.deps.baseUrl}/.well-known/oauth-protected-resource/mcp`;
  }

  protectedResourceMetadata() {
    return {
      resource: this.resource,
      authorization_servers: [this.deps.baseUrl],
      scopes_supported: [...TOKEN_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Ordler MCP',
    };
  }

  authorizationServerMetadata() {
    const base = this.deps.baseUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      scopes_supported: [...TOKEN_SCOPES],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    };
  }

  /** Dynamic client registration (RFC 7591). Anyone may register; members decide on consent. */
  async register(body: unknown) {
    const parsed = oauthClientRegistrationSchema.safeParse(body);
    if (!parsed.success) throw new OAuthError('invalid_client_metadata');
    const uris = parsed.data.redirect_uris;
    if (!uris.every(isAllowedRedirect)) throw new OAuthError('invalid_redirect_uri');
    const id = `oc_${randomToken(18)}`;
    const name = parsed.data.client_name ?? new URL(uris[0]!).host ?? 'MCP client';
    const [row] = await this.deps.db
      .insert(oauthClients)
      .values({ id, name, redirectUris: uris })
      .returning();
    return {
      client_id: id,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(row!.createdAt.getTime() / 1000),
    };
  }

  /** Checks a request before the consent page shows it; errors here never redirect. */
  async consent(memberId: string, query: OAuthAuthorizeQuery): Promise<OAuthConsentView> {
    const client = await this.client(query.client_id);
    if (!redirectMatches(client.redirectUris, query.redirect_uri)) {
      throw new DomainError('oauth_invalid_request');
    }
    if (query.resource && trimSlash(query.resource) !== this.resource) {
      throw new DomainError('oauth_invalid_request');
    }
    await this.assertMayGrant(memberId);
    const scopes = parseOAuthScopes(query.scope);
    if (scopes.length === 0) throw new DomainError('oauth_invalid_request');
    return {
      client: { id: client.id, name: client.name },
      redirectHost: redirectLabel(query.redirect_uri),
      scopes,
    };
  }

  /** The member's answer, as the URL to send the browser back to the client. */
  async decide(
    memberId: string,
    query: OAuthAuthorizeQuery,
    approve: boolean,
    chosen: TokenScope[],
  ): Promise<{ redirect: string }> {
    const view = await this.consent(memberId, query);
    const target = new URL(query.redirect_uri);
    if (query.state) target.searchParams.set('state', query.state);
    target.searchParams.set('iss', this.deps.baseUrl);
    const scopes = view.scopes.filter((scope) => chosen.includes(scope));
    if (!approve || scopes.length === 0) {
      target.searchParams.set('error', 'access_denied');
      return { redirect: target.toString() };
    }
    const code = randomToken();
    await this.deps.db.insert(oauthCodes).values({
      codeHash: sha256(code),
      clientId: query.client_id,
      memberId,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      scopes,
      expiresAt: new Date(this.now().getTime() + CODE_TTL_MS),
    });
    target.searchParams.set('code', code);
    return { redirect: target.toString() };
  }

  /** The token endpoint: authorization_code (with PKCE) and refresh_token grants. */
  async token(form: Record<string, string | undefined>) {
    const clientId = form.client_id;
    if (!clientId) throw new OAuthError('invalid_client', 401);
    let tokens: OAuthTokens | undefined;
    if (form.grant_type === 'authorization_code') {
      tokens = await this.exchangeCode(clientId, form);
    } else if (form.grant_type === 'refresh_token') {
      if (!form.refresh_token) throw new OAuthError('invalid_request');
      tokens = await this.deps.tokens.refreshOAuthGrant(form.refresh_token, clientId);
      if (!tokens) throw new OAuthError('invalid_grant');
    } else {
      throw new OAuthError('unsupported_grant_type');
    }
    return {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scopes.join(' '),
    };
  }

  private async exchangeCode(
    clientId: string,
    form: Record<string, string | undefined>,
  ): Promise<OAuthTokens> {
    if (!form.code || !form.redirect_uri || !form.code_verifier) {
      throw new OAuthError('invalid_request');
    }
    if (form.resource && trimSlash(form.resource) !== this.resource) {
      throw new OAuthError('invalid_request');
    }
    const [code] = await this.deps.db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.codeHash, sha256(form.code)));
    if (!code || code.clientId !== clientId || code.redirectUri !== form.redirect_uri) {
      throw new OAuthError('invalid_grant');
    }
    if (code.usedAt) {
      // A replayed code means it leaked: the grant issued for it is no longer trusted.
      if (code.tokenId) await this.deps.tokens.revokeGrant(code.tokenId);
      throw new OAuthError('invalid_grant');
    }
    if (code.expiresAt <= this.now()) throw new OAuthError('invalid_grant');
    const challenge = createHash('sha256').update(form.code_verifier).digest('base64url');
    if (challenge !== code.codeChallenge) throw new OAuthError('invalid_grant');

    const claimed = await this.deps.db
      .update(oauthCodes)
      .set({ usedAt: this.now() })
      // Only one exchange wins, even when two arrive at once.
      .where(and(eq(oauthCodes.codeHash, code.codeHash), isNull(oauthCodes.usedAt)))
      .returning({ usedAt: oauthCodes.usedAt });
    if (claimed.length === 0) throw new OAuthError('invalid_grant');
    const client = await this.client(clientId);
    let tokens: OAuthTokens;
    try {
      tokens = await this.deps.tokens.createOAuthGrant(
        code.memberId,
        { id: client.id, name: client.name },
        code.scopes as TokenScope[],
      );
    } catch {
      // The member lost the right to create tokens between consent and exchange.
      throw new OAuthError('invalid_grant');
    }
    await this.deps.db
      .update(oauthCodes)
      .set({ tokenId: tokens.tokenId })
      .where(eq(oauthCodes.codeHash, code.codeHash));
    return tokens;
  }

  private async assertMayGrant(memberId: string): Promise<void> {
    if (!(await this.deps.tokens.settings()).mcpEnabled) throw new DomainError('forbidden');
    const access = await this.deps.access.load(memberId);
    if (!holdsAnywhere(access, 'mcp.use') || !holdsAnywhere(access, 'token.create_personal')) {
      throw new DomainError('forbidden');
    }
  }

  private async client(id: string) {
    const [client] = await this.deps.db.select().from(oauthClients).where(eq(oauthClients.id, id));
    if (!client) throw new DomainError('oauth_invalid_request');
    return client;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** HTTPS anywhere, plain HTTP only on loopback, or a native app's own scheme (RFC 8252). */
export function isAllowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || UNSAFE_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** Exact match, except that loopback redirects may use any port (RFC 8252 §7.3). */
function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let asked: URL;
  try {
    asked = new URL(uri);
  } catch {
    return false;
  }
  if (asked.protocol !== 'http:' || !LOOPBACK.has(asked.hostname)) return false;
  return registered.some((candidate) => {
    const known = new URL(candidate);
    return (
      known.protocol === 'http:' &&
      known.hostname === asked.hostname &&
      known.pathname === asked.pathname &&
      known.search === asked.search
    );
  });
}

function redirectLabel(uri: string): string {
  const url = new URL(uri);
  return url.host || `${url.protocol}//`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
