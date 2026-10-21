import { z } from 'zod';

/** What a personal access token may do; it never exceeds its member (SPEC §10.1). */
export const TOKEN_SCOPES = ['read', 'issues:write', 'requests:write'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const PERSONAL_TOKEN_PREFIX = 'ordl_pat_';
export const DEFAULT_TOKEN_EXPIRY_DAYS = 90;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(TOKEN_SCOPES))
    .min(1)
    .transform((scopes) => [...new Set(scopes)]),
  /** null: no expiry, only if the admin allows it. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(DEFAULT_TOKEN_EXPIRY_DAYS),
});
export type CreateTokenInput = z.input<typeof createTokenSchema>;

/** Admin → Access tokens and MCP. */
export const tokenSettingsSchema = z.object({
  mcpEnabled: z.boolean(),
  maxExpiryDays: z.number().int().min(1).max(3650),
  allowNoExpiry: z.boolean(),
});
export type TokenSettings = z.infer<typeof tokenSettingsSchema>;

export interface PersonalTokenView {
  id: string;
  name: string;
  /** Visible start of the token, e.g. `ordl_pat_3fA9`. */
  prefix: string;
  scopes: TokenScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Set in the admin listing. */
  member?: { id: string; name: string };
}

/** The secret is returned exactly once, on creation. */
export interface CreatedToken {
  token: string;
  view: PersonalTokenView;
}

export const TOKEN_ERROR_CODES = ['token_expiry_too_long'] as const;
export type TokenErrorCode = (typeof TOKEN_ERROR_CODES)[number];
