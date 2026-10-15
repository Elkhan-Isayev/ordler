import type { AuthStrategyKind } from './auth.js';

/** Response of GET /api/me and of every successful sign-in. */
export interface MeResponse {
  member: { id: string; name: string; email: string; locale: string | null };
  workspace: { companyName: string; defaultLocale: string };
  departments: Array<{
    id: string;
    name: string;
    teams: Array<{ id: string; key: string; name: string }>;
  }>;
}

/** Response item of GET /api/auth/strategies. */
export interface PublicStrategy {
  kind: AuthStrategyKind;
  displayName: string | null;
}

/** Error body for every non-2xx API response. */
export interface ApiErrorBody {
  error: string;
  issues?: Array<{ path: string; message: string }>;
}
