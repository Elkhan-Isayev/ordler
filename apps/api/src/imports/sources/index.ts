import type { ImportSource } from '@ordler/shared';
import { JiraSource } from './jira.js';
import { LinearSource } from './linear.js';
import { nodeFetch, type HttpFetch, type ImportSourceAdapter } from './types.js';

export interface SourceCredentials {
  source: ImportSource;
  baseUrl: string | null;
  email: string | null;
  token: string;
}

export type SourceFactory = (credentials: SourceCredentials) => ImportSourceAdapter;

export function sourceFactory(fetch: HttpFetch = nodeFetch): SourceFactory {
  return (c) =>
    c.source === 'linear'
      ? new LinearSource(c.token, fetch)
      : new JiraSource(c.baseUrl!, { email: c.email ?? undefined, token: c.token }, fetch);
}
