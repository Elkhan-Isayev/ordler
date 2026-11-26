import type { AuthStrategyKind } from './auth.js';
import type { Permission } from './permissions.js';
import type { Theme } from './preferences.js';
import type { IssueSummary } from './issues.js';
import type { RequestSummary } from './requests.js';
import type { WikiSearchHit } from './wiki.js';

/** Response of GET /api/me and of every successful sign-in. */
export interface MeResponse {
  member: { id: string; name: string; email: string; locale: string | null; theme: Theme };
  workspace: { companyName: string; defaultLocale: string };
  /** Effective at organization scope; the UI only uses it to show or hide controls. */
  organizationPermissions: Permission[];
  departments: Array<{
    id: string;
    name: string;
    /** The member may open the department-wide request queue (request.read_department). */
    readRequests?: boolean;
    /** `manage`: the member may change team settings such as Slack channels (team.update). */
    teams: Array<{ id: string; key: string; name: string; manage?: boolean }>;
  }>;
}

/** Where Ordler's source code is published; AGPL §13 asks every instance to offer it. */
export const DEFAULT_SOURCE_URL = 'https://github.com/Elkhan-Isayev/ordler';

/** Response of GET /api/about: public, so the source offer reaches every user. */
export interface AboutResponse {
  version: string;
  license: 'AGPL-3.0-only';
  /** The source of the code this instance runs; a modified build points at its own. */
  sourceUrl: string;
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

/** Response of GET /api/search (SPEC §5.4): everything the member may open, by kind. */
export interface SearchResults {
  issues: IssueSummary[];
  requests: RequestSummary[];
  wikiPages: WikiSearchHit[];
}
