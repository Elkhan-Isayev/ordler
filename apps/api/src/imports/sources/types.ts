import type { ImportContainer, IssueStatusCategory, Priority } from '@ordler/shared';

export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface ExternalPerson {
  /** Email when visible, otherwise the display name: the key of the people map. */
  id: string;
  name: string;
  email: string | null;
}

export interface ExternalComment {
  externalId: string;
  author: ExternalPerson | null;
  body: string;
  createdAt: string;
}

export interface ExternalAttachment {
  /** Id or file name that `jira-attachment:` / upload links in the text refer to. */
  ref: string;
  filename: string;
  url: string;
  size: number | null;
}

/** One issue, already in Ordler's vocabulary (ADR 0010). */
export interface ExternalIssue {
  externalId: string;
  key: string;
  url: string;
  title: string;
  description: string;
  status: { name: string; category: IssueStatusCategory };
  priority: Priority;
  assignees: ExternalPerson[];
  creator: ExternalPerson | null;
  labels: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  parentExternalId: string | null;
  comments: ExternalComment[];
  attachments: ExternalAttachment[];
  /** Things Ordler cannot store yet; listed in the report. */
  dropped: string[];
}

export interface SourcePage {
  issues: ExternalIssue[];
  next: string | null;
}

export interface ImportSourceAdapter {
  account(): Promise<{ name: string; email: string | null }>;
  containers(): Promise<ImportContainer[]>;
  people(containerIds: string[]): Promise<ExternalPerson[]>;
  page(
    container: ImportContainer,
    cursor: string | null,
    options: { includeClosed: boolean; jql?: string | undefined },
  ): Promise<SourcePage>;
  /** Downloads a file with the source's credentials. */
  download(url: string): Promise<{ data: Buffer; contentType: string }>;
}

export class SourceError extends Error {
  constructor(
    readonly code: 'import_auth_failed' | 'import_source_failed',
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Calls a source API: 401/403 are credential errors, 429 asks the runner to wait. */
export async function sourceJson(
  fetch: HttpFetch,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
): Promise<unknown> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (response.status === 401 || response.status === 403) {
    throw new SourceError(
      'import_auth_failed',
      `The source refused the token (HTTP ${response.status})`,
    );
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after')) || 30;
    throw new SourceError('import_source_failed', 'Rate limited by the source', seconds * 1000);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new SourceError(
      'import_source_failed',
      `The source answered HTTP ${response.status} for ${url}`,
    );
  }
  return response.json();
}

/** The platform fetch with a timeout, so a hung source cannot hold a run's lease forever. */
export const nodeFetch: HttpFetch = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
