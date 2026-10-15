import type { MeResponse } from '@ordler/shared';
import { vi } from 'vitest';

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (body: unknown) => { status?: number; json?: unknown };

/** Stubs fetch with `METHOD /path` handlers and records every call. */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const handler = handlers[`${method} ${path}`];
      if (!handler) return new Response(JSON.stringify({ error: 'not_mocked' }), { status: 500 });
      const { status = 200, json } = handler(body);
      return status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(json ?? {}), { status });
    }),
  );
  return calls;
}

export const ME: MeResponse = {
  member: { id: 'm1', name: 'Ann Lee', email: 'ann@push30.test', locale: null },
  workspace: { companyName: 'Push30', defaultLocale: 'ru' },
  organizationPermissions: ['org.manage'],
  departments: [{ id: 'd1', name: 'IT', teams: [{ id: 't1', key: 'HELP', name: 'Helpdesk' }] }],
};
