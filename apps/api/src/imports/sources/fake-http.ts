import type { HttpFetch } from './types.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers from recorded responses, in order, and records what it was asked. */
export function recordedFetch(
  responses: Array<{
    status?: number;
    json?: unknown;
    body?: string;
    headers?: Record<string, string>;
  }>,
): { fetch: HttpFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: HttpFetch = (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request ${init.method} ${url}`);
    const headers = new Map(Object.entries(next.headers ?? {}));
    return Promise.resolve({
      status: next.status ?? 200,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      json: () => Promise.resolve(next.json),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(next.body ?? '').buffer),
    });
  };
  return { fetch, calls };
}
