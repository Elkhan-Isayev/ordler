import { compareSemver, parseSemver, type SemVer } from './version.js';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface Release {
  version: SemVer;
  tag: string;
  name: string;
  url: string;
  notes: string;
  publishedAt: Date;
}

export type ReleaseLookup =
  | { status: 'ok'; release: Release | undefined; etag: string | undefined }
  | { status: 'not_modified' };

interface GitHubRelease {
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
}

/** Release notes are shown in the admin panel; the full text stays on GitHub. */
const MAX_NOTES = 20_000;

/**
 * Reads the newest stable release from the public GitHub API. Anonymous: nothing about the
 * installation is sent beyond the request itself (SPEC §16.5). Uses the ETag so repeated
 * checks do not count against GitHub's rate limit.
 */
export async function fetchLatestRelease(input: {
  repository: string;
  currentVersion: string | undefined;
  etag?: string | undefined;
  fetch?: FetchFn;
  timeoutMs?: number;
}): Promise<ReleaseLookup> {
  const fetchFn = input.fetch ?? ((url, init) => fetch(url, init));
  const response = await fetchFn(
    `https://api.github.com/repos/${input.repository}/releases?per_page=20`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': `Ordler/${input.currentVersion ?? 'development'}`,
        ...(input.etag ? { 'if-none-match': input.etag } : {}),
      },
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    },
  );
  if (response.status === 304) return { status: 'not_modified' };
  if (!response.ok) throw new Error(`GitHub responded ${response.status}`);

  const releases = (await response.json()) as GitHubRelease[];
  let best: Release | undefined;
  for (const item of Array.isArray(releases) ? releases : []) {
    // Drafts and pre-releases never trigger the admin notification.
    if (item.draft || item.prerelease || !item.tag_name || !item.html_url) continue;
    const version = parseSemver(item.tag_name);
    if (!version || version.prerelease) continue;
    const candidate: Release = {
      version,
      tag: item.tag_name,
      name: item.name?.trim() || item.tag_name,
      url: item.html_url,
      notes: (item.body ?? '').slice(0, MAX_NOTES),
      publishedAt: new Date(item.published_at ?? 0),
    };
    if (!best || compareSemver(candidate.version, best.version) > 0) best = candidate;
  }
  return { status: 'ok', release: best, etag: response.headers.get('etag') ?? undefined };
}
