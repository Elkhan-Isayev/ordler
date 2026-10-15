import { z } from 'zod';
import { SUPPORTED_LOCALES } from './locales.js';

/** Sign-in strategies available in Phase 1 (SPEC §8.1). */
export const AUTH_STRATEGY_KINDS = ['local', 'email_otp', 'google'] as const;
export type AuthStrategyKind = (typeof AUTH_STRATEGY_KINDS)[number];

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;
export const OTP_LENGTH = 6;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .pipe(z.string().max(254));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'password_too_short')
  .max(PASSWORD_MAX_LENGTH, 'password_too_long')
  .refine((value) => value.trim().length === value.length, 'password_whitespace_edges');

const personNameSchema = z.string().trim().min(1).max(120);

export const setupSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  defaultLocale: z.enum(SUPPORTED_LOCALES),
  owner: z.object({
    name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
  }),
});
export type SetupInput = z.infer<typeof setupSchema>;

export const passwordSignInSchema = z.object({
  email: emailSchema,
  // Length limits only: policy is enforced when passwords are set, not when they are used.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type PasswordSignInInput = z.infer<typeof passwordSignInSchema>;

export const otpRequestSchema = z.object({ email: emailSchema });
export const otpVerifySchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), 'otp_format'),
});

/** Domain names like `company.com`; stored lowercase without a leading `@`. */
export const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,63}$/, 'invalid_domain'));

export const updateAuthStrategySchema = z
  .object({
    enabled: z.boolean(),
    position: z.number().int().min(0).max(100),
    displayName: z.string().trim().max(60).nullable(),
    allowSelfRegistration: z.boolean(),
    allowedDomains: z.array(emailDomainSchema).max(50),
    defaultRoleId: z.uuid().nullable(),
    config: z.object({
      clientId: z.string().trim().min(1).max(512).optional(),
      hostedDomain: emailDomainSchema.nullable().optional(),
    }),
    /** Write-only: present to set or replace, never returned by the API. */
    secrets: z.object({ clientSecret: z.string().min(1).max(512).optional() }),
  })
  .partial();
export type UpdateAuthStrategyInput = z.infer<typeof updateAuthStrategySchema>;

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/** An empty allow-list means any domain may self-register. */
export function isEmailDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = emailDomain(email);
  return allowedDomains.some((allowed) => allowed.toLowerCase() === domain);
}

/** Stable error codes the API returns and the UI translates. */
export const AUTH_ERROR_CODES = [
  'invalid_credentials',
  'invalid_code',
  'strategy_disabled',
  'registration_closed',
  'domain_not_allowed',
  'rate_limited',
  'setup_completed',
  'setup_required',
  'lockout_prevented',
  'mail_not_configured',
  'oauth_failed',
  'email_not_verified',
  'validation_failed',
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
