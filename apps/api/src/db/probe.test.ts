import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConfig } from '../config/env.js';
import { classify, probeDatabase, type ProbeClient } from './probe.js';

const CONFIG: DatabaseConfig = {
  host: 'db.push30.test',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  schema: 'ordler',
  ssl: 'disable',
  poolMax: 5,
};

let pglite: PGlite;

/** Runs the probe's real SQL on PostgreSQL 18 (PGlite) with optional overrides. */
function client(overrides: Partial<ProbeClient> = {}): ProbeClient {
  return {
    connect: async () => undefined,
    query: async (sql, params) => {
      const result = await pglite.query<Record<string, unknown>>(sql, params as unknown[]);
      return { rows: result.rows };
    },
    end: async () => undefined,
    ...overrides,
  };
}

beforeEach(async () => {
  pglite = new PGlite();
  await pglite.waitReady;
});
afterEach(() => pglite.close());

describe('probeDatabase', () => {
  it('accepts PostgreSQL 18 with CREATE privilege', async () => {
    const result = await probeDatabase(CONFIG, () => client());
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.serverVersion).toMatch(/^18/);
  });

  it('rejects servers older than PostgreSQL 18', async () => {
    const old = client({
      query: async () => ({ rows: [{ num: 160004, version: '16.4', can_create: true }] }),
    });
    expect(await probeDatabase(CONFIG, () => old)).toEqual({
      ok: false,
      error: 'postgres_too_old',
      detail: 'PostgreSQL 16.4',
    });
  });

  it('reports missing privileges with the statement for the DBA', async () => {
    const limited = client({
      query: async () => ({
        rows: [{ num: 180001, version: '18.1', can_create: false, schema_create: null }],
      }),
    });
    expect(await probeDatabase(CONFIG, () => limited)).toEqual({
      ok: false,
      error: 'insufficient_privileges',
      detail: 'GRANT CREATE ON DATABASE ordler TO ordler;',
    });
  });

  it('accepts a user that owns an existing schema without database CREATE', async () => {
    const owner = client({
      query: async () => ({
        rows: [{ num: 180001, version: '18.1', can_create: false, schema_create: true }],
      }),
    });
    expect(await probeDatabase(CONFIG, () => owner)).toEqual({ ok: true, serverVersion: '18.1' });
  });

  it('classifies connection failures', async () => {
    const refused = client({
      connect: async () => {
        throw Object.assign(new Error('password authentication failed for user "ordler"'), {
          code: '28P01',
        });
      },
    });
    expect(await probeDatabase(CONFIG, () => refused)).toEqual({
      ok: false,
      error: 'authentication_failed',
      detail: 'password authentication failed for user "ordler"',
    });
  });
});

describe('classify', () => {
  it.each([
    [{ code: '3D000', message: 'database "x" does not exist' }, 'database_not_found'],
    [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, 'connection_failed'],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND db' }, 'connection_failed'],
    [{ message: 'The server does not support SSL connections' }, 'tls_failed'],
    [{ code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'self-signed' }, 'tls_failed'],
  ])('%j → %s', (error, expected) => {
    expect(classify(error)).toBe(expected);
  });
});
