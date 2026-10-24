import type {
  AdminErrorCode,
  AttachmentErrorCode,
  AuthErrorCode,
  IssueErrorCode,
  RequestErrorCode,
  TokenErrorCode,
} from '@ordler/shared';

export type DomainErrorCode =
  | AuthErrorCode
  | AdminErrorCode
  | IssueErrorCode
  | AttachmentErrorCode
  | RequestErrorCode
  | TokenErrorCode;

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
  system_role: 409,
  role_in_use: 409,
  role_name_taken: 409,
  mail_managed_by_env: 409,
  database_managed_by_env: 409,
  forbidden: 403,
  token_expiry_too_long: 400,
  status_not_in_workflow: 400,
  assignee_not_in_team: 400,
  not_in_triage: 409,
  label_not_in_team: 400,
  label_name_taken: 409,
  invalid_parent: 400,
  status_in_use: 409,
  status_required: 409,
  single_assignee: 400,
  cycle_not_in_team: 400,
  project_not_in_team: 400,
  file_too_large: 413,
  file_missing: 400,
  form_invalid: 400,
  approvals_not_allowed: 400,
  not_an_approver: 403,
  already_decided: 409,
  step_not_active: 409,
  invalid_transition: 409,
  session_required: 403,
  request_type_archived: 409,
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
