import type { AuthStrategyKind } from './auth.js';
import type { Permission } from './permissions.js';

/** Response of GET /api/me and of every successful sign-in. */
export interface MeResponse {
  member: { id: string; name: string; email: string; locale: string | null };
  workspace: { companyName: string; defaultLocale: string };
  /** Effective at organization scope; the UI only uses it to show or hide controls. */
  organizationPermissions: Permission[];
  departments: Array<{
    id: string;
    name: string;
    /** `manage`: the member may change team settings such as Slack channels (team.update). */
    teams: Array<{ id: string; key: string; name: string; manage?: boolean }>;
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

/** Response of GET /api/admin/updates (SPEC §16.5). */
export interface UpdateStatusResponse {
  enabled: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  majorUpgrade: boolean;
  release: { name: string; url: string; notes: string; publishedAt: string } | null;
  checkedAt: string | null;
  lastError: string | null;
}
