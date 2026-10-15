/** Arbitrary but fixed key so every replica contends for the same PostgreSQL advisory lock. */
export const MIGRATION_LOCK_KEY = 4_206_660_001;

export interface LockClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Runs `fn` while holding a session-level advisory lock, so that when several replicas start
 * at once exactly one applies migrations and the others wait, then find nothing to do (SPEC §16.3).
 */
export async function withAdvisoryLock<T>(
  client: LockClient,
  key: number,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('select pg_advisory_lock($1)', [key]);
  try {
    return await fn();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [key]);
  }
}

/** Schema names are validated by config, but quoting keeps this safe if that ever changes. */
export function createSchemaSql(schema: string): string {
  return `create schema if not exists "${schema.replaceAll('"', '""')}"`;
}
