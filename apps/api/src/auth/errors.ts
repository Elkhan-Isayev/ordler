import type { AdminErrorCode, AuthErrorCode } from '@ordler/shared';

export type DomainErrorCode = AuthErrorCode | AdminErrorCode;

const STATUS: Record<DomainErrorCode, number> = {
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
  not_found: 404,
  team_key_taken: 409,
  department_name_taken: 409,
  email_taken: 409,
  last_owner: 409,
  cannot_change_self: 409,
  owner_only: 403,
  invite_invalid: 410,
  archived: 409,
  mail_managed_by_env: 409,
  database_managed_by_env: 409,
};

/** Expected business failures; mapped to `{ error: code }` responses by the HTTP layer. */
export class DomainError extends Error {
  override name = 'DomainError';

  constructor(
    readonly code: DomainErrorCode,
    readonly status: number = STATUS[code],
  ) {
    super(code);
  }
}
