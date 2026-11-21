import { z } from 'zod';

/** What a GitHub item linked to an issue is (ADR 0019). */
export const GITHUB_LINK_KINDS = ['branch', 'pull_request', 'commit'] as const;
export type GithubLinkKind = (typeof GITHUB_LINK_KINDS)[number];

/** Pull request states as Ordler shows them; `draft` is an open draft. */
export const GITHUB_PULL_STATES = ['open', 'draft', 'merged', 'closed'] as const;
export type GithubPullState = (typeof GITHUB_PULL_STATES)[number];

export const DEFAULT_GITHUB_URL = 'https://github.com';

/** One item may mention many issues; more than this is treated as noise. */
export const MAX_LINKED_ISSUES = 20;

// Letters can't precede the key (XENG-1 is not ENG-1) and digits can't follow the number.
const IDENTIFIER = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})(?![0-9])/g;

/**
 * Issue identifiers mentioned in a branch name, pull request title/body or commit message, in
 * any case (`elkhan/eng-12-fix` → `ENG-12`), uppercased, unique, in order of appearance.
 */
export function findIssueIdentifiers(...texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(IDENTIFIER)) {
      const number = Number(match[2]);
      if (number <= 0) continue;
      found.add(`${match[1]!.toUpperCase()}-${number}`);
      if (found.size >= MAX_LINKED_ISSUES) return [...found];
    }
  }
  return [...found];
}

/** Lowercase ASCII words joined by dashes; other scripts drop out. */
function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Linear-style branch name: `<handle>/<identifier>-<short-title>`, e.g.
 * `elkhan/eng-12-fix-login`. The handle is the local part of the member's email.
 */
export function issueBranchName(email: string, identifier: string, title: string): string {
  const handle = slug(email.split('@')[0] ?? '').slice(0, 30);
  const id = identifier.toLowerCase();
  const room = Math.max(0, 60 - id.length - 1);
  const words = slug(title).slice(0, room).replace(/-+$/, '');
  const name = words ? `${id}-${words}` : id;
  return handle ? `${handle}/${name}` : name;
}

/** A branch, pull request or commit linked to an issue (ADR 0019). */
export interface GithubLinkView {
  id: string;
  kind: GithubLinkKind;
  /** `owner/name`. */
  repository: string;
  /** Branch name, pull request number or full commit SHA. */
  ref: string;
  /** Pull request title or first line of the commit message. */
  title: string | null;
  /** Pull requests only. */
  state: GithubPullState | null;
  url: string;
  author: string | null;
  updatedAt: string;
}

/** Response of GET /api/issues/:identifier/github. */
export interface IssueGithubView {
  /** Suggested branch name for the signed-in member. */
  branchName: string;
  links: GithubLinkView[];
}

const githubUrl = z
  .url({ protocol: /^https?$/ })
  .max(255)
  .transform((value) => value.replace(/\/+$/, ''));

const organization = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
  .nullable()
  .optional();

/**
 * Admin → Integrations → GitHub. The private key and webhook secret are write-only: omit to
 * keep the stored value, `null` to clear it.
 */
export const updateGithubAppSchema = z.object({
  enabled: z.boolean(),
  githubUrl,
  organization,
  appId: z
    .string()
    .trim()
    .regex(/^[0-9]{1,12}$/)
    .nullable()
    .optional(),
  privateKey: z
    .string()
    .trim()
    .regex(/^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----$/)
    .max(8192)
    .nullable()
    .optional(),
  webhookSecret: z.string().trim().min(16).max(256).nullable().optional(),
});
export type UpdateGithubAppInput = z.infer<typeof updateGithubAppSchema>;

/** Starts the manifest flow: which GitHub, and the organization that will own the app. */
export const githubManifestSchema = z.object({ githubUrl, organization });
export type GithubManifestInput = z.infer<typeof githubManifestSchema>;

/** The browser posts `manifest` to `url` as a form; GitHub redirects back to Ordler. */
export interface GithubManifestStart {
  url: string;
  manifest: string;
}

/** Response of GET /api/admin/github-app. */
export interface GithubAppView {
  enabled: boolean;
  githubUrl: string;
  organization: string | null;
  appId: string | null;
  appSlug: string | null;
  privateKeySet: boolean;
  webhookSecretSet: boolean;
  /** Where to install the app on repositories; null until the app exists. */
  installUrl: string | null;
  /** The URL GitHub delivers webhooks to. */
  webhookUrl: string;
  lastDeliveryAt: string | null;
  lastError: string | null;
}

/** Team settings → GitHub: statuses set when a pull request opens or merges; null is off. */
export interface TeamGithubSettings {
  openedStatusId: string | null;
  mergedStatusId: string | null;
}

export const updateTeamGithubSchema = z.object({
  openedStatusId: z.uuid().nullable(),
  mergedStatusId: z.uuid().nullable(),
});
export type UpdateTeamGithubInput = z.infer<typeof updateTeamGithubSchema>;
