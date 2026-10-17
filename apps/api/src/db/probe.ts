import type { DatabaseProbeError, DatabaseProbeResult } from '@ordler/shared';
import pg from 'pg';
import type { DatabaseConfig } from '../config/env.js';
import { toPoolConfig } from './pool-config.js';

/** PostgreSQL 18 is the minimum: Ordler relies on native uuidv7() (SPEC §16.3). */
export const MIN_SERVER_VERSION_NUM = 180000;

export interface ProbeClient {
  connect(): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export type ProbeClientFactory = (config: DatabaseConfig) => ProbeClient;

const pgClient: ProbeClientFactory = (config) => {
  // A single probe connection; pg.Client ignores the pool-only `max` option.
  return new pg.Client({ ...toPoolConfig(config), connectionTimeoutMillis: 10_000 });
};

/**
 * Checks what the installer and Admin → Database promise before saving settings: the server
 * answers, the credentials work, it runs PostgreSQL 18+, and the user may create the Ordler
 * schema (or already owns it).
 */
export async function probeDatabase(
  config: DatabaseConfig,
  createClient: ProbeClientFactory = pgClient,
): Promise<DatabaseProbeResult> {
  const client = createClient(config);
  try {
    await client.connect();
  } catch (error) {
    return { ok: false, error: classify(error), detail: message(error) };
  }
  try {
    const { rows } = await client.query(
      `select current_setting('server_version_num')::int as num,
              current_setting('server_version') as version,
              has_database_privilege(current_user, current_database(), 'CREATE') as can_create,
              (select has_schema_privilege(current_user, n.oid, 'CREATE')
                 from pg_namespace n where n.nspname = $1) as schema_create`,
      [config.schema],
    );
    const row = rows[0] ?? {};
    const version = String(row.version ?? '');
    if (Number(row.num) < MIN_SERVER_VERSION_NUM) {
      return { ok: false, error: 'postgres_too_old', detail: `PostgreSQL ${version}` };
    }
    // An existing schema needs CREATE on it; a missing one needs CREATE on the database.
    const allowed =
      row.schema_create === null ? row.can_create === true : row.schema_create === true;
    if (!allowed) {
      return {
        ok: false,
        error: 'insufficient_privileges',
        detail: `GRANT CREATE ON DATABASE ${String(config.database ?? 'ordler')} TO ${String(config.user ?? 'ordler')};`,
      };
    }
    return { ok: true, serverVersion: version };
  } catch (error) {
    return { ok: false, error: 'connection_failed', detail: message(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function classify(error: unknown): DatabaseProbeError {
  const { code, message: text = '' } = (error ?? {}) as { code?: string; message?: string };
  // SQLSTATE 28P01 invalid_password, 28000 invalid_authorization_specification.
  if (code === '28P01' || code === '28000') return 'authentication_failed';
  if (code === '3D000') return 'database_not_found';
  if ((code && TLS_CODES.has(code)) || /\b(SSL|TLS|certificate)\b/i.test(text)) return 'tls_failed';
  return 'connection_failed';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
