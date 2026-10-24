import { z } from 'zod';

/** Import from Linear and Jira by API token (SPEC §10.2, ADR 0010). */
export const IMPORT_SOURCES = ['linear', 'jira'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const importConnectSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('linear'), token: z.string().trim().min(10).max(500) }),
  z.object({
    source: z.literal('jira'),
    baseUrl: z.url({ protocol: /^https$/ }).max(300),
    /** Jira Cloud signs in with email + API token; Server/DC with a personal token alone. */
    email: z.email().max(200).optional(),
    token: z.string().trim().min(10).max(500),
  }),
]);
export type ImportConnectInput = z.infer<typeof importConnectSchema>;

export const importConfigSchema = z.object({
  containers: z
    .array(
      z.object({
        externalId: z.string().min(1).max(100),
        /** Existing team, or a new one created in a department. */
        teamId: z.uuid().optional(),
        newTeam: z
          .object({
            name: z.string().trim().min(1).max(120),
            key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
            departmentId: z.uuid(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(50),
  /** Per source container: source status name → Ordler status id. Missing ones map by category. */
  statusMap: z.record(z.string(), z.record(z.string(), z.uuid())).default({}),
  /** Source person (email, or name when the source hides emails) → Ordler member or nobody. */
  peopleMap: z.record(z.string(), z.uuid().nullable()).default({}),
  includeClosed: z.boolean().default(true),
  /** Jira only: extra JQL, combined with the project. */
  jql: z.string().max(2000).optional(),
});
export type ImportConfig = z.input<typeof importConfigSchema>;
export type ImportConfigData = z.output<typeof importConfigSchema>;

export type ImportStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled';

export interface ImportCounts {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  comments: number;
  attachments: number;
}

export interface ImportReportItem {
  key: string;
  outcome: 'imported' | 'updated' | 'skipped' | 'failed';
  identifier?: string;
  reason?: string;
}

export interface ImportRunView {
  id: string;
  source: ImportSource;
  baseUrl: string | null;
  account: { name: string; email: string | null };
  status: ImportStatus;
  config: ImportConfigData | null;
  counts: ImportCounts;
  report: ImportReportItem[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImportContainer {
  id: string;
  key: string;
  name: string;
  statuses: Array<{
    name: string;
    category: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
  }>;
}

export interface ImportPerson {
  /** Email when the source shows it, otherwise the display name. */
  id: string;
  name: string;
  email: string | null;
  /** Ordler member with the same email, if any. */
  suggestedMemberId: string | null;
}

export interface ImportOptions {
  containers: ImportContainer[];
  people: ImportPerson[];
}

export interface ImportDryRun {
  containers: Array<{
    externalId: string;
    name: string;
    issues: number;
    comments: number;
    attachments: number;
  }>;
  unmappedPeople: string[];
  oversizeAttachments: number;
  warnings: string[];
}

export const IMPORT_ERROR_CODES = [
  'import_auth_failed',
  'import_source_failed',
  'import_not_ready',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];
