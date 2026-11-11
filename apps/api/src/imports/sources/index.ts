import type { ImportSource } from '@ordler/shared';
import { JiraSource } from './jira.js';
import { LinearSource } from './linear.js';
import { TrelloSource } from './trello.js';
import { nodeFetch, type HttpFetch, type ImportSourceAdapter } from './types.js';

export interface SourceCredentials {
  source: ImportSource;
  baseUrl: string | null;
  email: string | null;
  token: string;
}

export type SourceFactory = (credentials: SourceCredentials) => ImportSourceAdapter;

export function sourceFactory(fetch: HttpFetch = nodeFetch): SourceFactory {
  return (c) => {
    if (c.source === 'linear') return new LinearSource(c.token, fetch);
    if (c.source === 'trello') return new TrelloSource(trelloCredentials(c.token), fetch);
    return new JiraSource(c.baseUrl!, { email: c.email ?? undefined, token: c.token }, fetch);
  };
}

/** Trello needs an API key and a token; they are sealed together as `key:token`. */
export function trelloSecret(apiKey: string, token: string): string {
  return `${apiKey}:${token}`;
}

function trelloCredentials(secret: string): { apiKey: string; token: string } {
  const at = secret.indexOf(':');
  return { apiKey: secret.slice(0, at), token: secret.slice(at + 1) };
}
