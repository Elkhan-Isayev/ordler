import { z } from 'zod';
import { TOKEN_SCOPES, type TokenScope } from './tokens.js';

/** OAuth 2.1 for MCP clients (SPEC §10.1): short-lived access, rotating refresh tokens. */
export const OAUTH_ACCESS_PREFIX = 'ordl_oat_';
export const OAUTH_REFRESH_PREFIX = 'ordl_ort_';

/** The query an MCP client sends to `/oauth/authorize`, validated before consent. */
export const oauthAuthorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  scope: z.string().max(500).optional(),
  state: z.string().max(1000).optional(),
  resource: z.string().max(2000).optional(),
});
export type OAuthAuthorizeQuery = z.infer<typeof oauthAuthorizeSchema>;

/** The member's decision; they may grant fewer scopes than the client asked for. */
export const oauthDecisionSchema = oauthAuthorizeSchema.extend({
  approve: z.boolean(),
  scopes: z.array(z.enum(TOKEN_SCOPES)).max(TOKEN_SCOPES.length).default([]),
});
export type OAuthDecision = z.input<typeof oauthDecisionSchema>;

/** What the consent page shows: who asks, where the answer goes, for what. */
export interface OAuthConsentView {
  client: { id: string; name: string };
  redirectHost: string;
  scopes: TokenScope[];
}

/** Dynamic client registration (RFC 7591), public clients only. */
export const oauthClientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().min(1).max(2000)).min(1).max(10),
  token_endpoint_auth_method: z.literal('none').optional(),
  grant_types: z.array(z.string()).max(5).optional(),
  response_types: z.array(z.string()).max(5).optional(),
});

/** Space-separated OAuth scope string to Ordler scopes; unknown names are dropped. */
export function parseOAuthScopes(scope: string | undefined): TokenScope[] {
  if (!scope) return [...TOKEN_SCOPES];
  const asked = scope.split(/\s+/).filter(Boolean);
  return TOKEN_SCOPES.filter((known) => asked.includes(known));
}
