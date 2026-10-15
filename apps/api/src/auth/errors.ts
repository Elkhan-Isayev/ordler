import type { AuthErrorCode } from '@ordler/shared';

const STATUS: Record<AuthErrorCode, number> = {
  invalid_credentials: 401,
  invalid_code: 401,
  strategy_disabled: 403,
  registration_closed: 403,
  domain_not_allowed: 403,
  rate_limited: 429,
  setup_completed: 409,
  setup_required: 409,
  lockout_prevented: 409,
  mail_not_configured: 409,
  oauth_failed: 401,
  email_not_verified: 403,
  validation_failed: 400,
};

/** Expected business failures; mapped to `{ error: code }` responses by the HTTP layer. */
export class DomainError extends Error {
  override name = 'DomainError';

  constructor(
    readonly code: AuthErrorCode,
    readonly status: number = STATUS[code],
  ) {
    super(code);
  }
}
