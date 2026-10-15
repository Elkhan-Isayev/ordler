import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BundledMigration {
  tag: string;
  /** Drizzle records this timestamp as `created_at` when the migration is applied. */
  when: number;
}

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export class SchemaTooNewError extends Error {
  override name = 'SchemaTooNewError';
}

export class PendingMigrationsError extends Error {
  override name = 'PendingMigrationsError';
}

export function readJournal(migrationsFolder: string): BundledMigration[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string; when: number }> };
  return journal.entries.map(({ tag, when }) => ({ tag, when }));
}

/**
 * Compares the database's applied migrations with the ones bundled in this image (SPEC §16.3).
 * A database migrated by a newer Ordler is refused: running old code on a newer schema is how
 * data gets silently corrupted, so a downgrade must go through a backup restore instead.
 */
export async function checkSchemaCompatibility(
  db: Queryable,
  migrationsSchema: string,
  bundled: readonly BundledMigration[],
): Promise<{ applied: number; pending: BundledMigration[] }> {
  const table = `"${migrationsSchema.replaceAll('"', '""')}"."__drizzle_migrations"`;
  const exists = await db.query('select to_regclass($1) as name', [table]);
  if (!(exists.rows[0] as { name: string | null } | undefined)?.name) {
    return { applied: 0, pending: [...bundled] };
  }

  const result = await db.query(`select created_at from ${table}`);
  const appliedAt = result.rows.map((row) =>
    Number((row as { created_at: string | number }).created_at),
  );
  const newestKnown = Math.max(0, ...bundled.map((m) => m.when));
  const unknown = appliedAt.filter((when) => when > newestKnown);
  if (unknown.length > 0) {
    throw new SchemaTooNewError(
      `The database was migrated by a newer Ordler version (${unknown.length} migration(s) unknown to this image). ` +
        'Run the newer image, or restore a backup taken before the upgrade. Starting would risk your data.',
    );
  }

  const lastApplied = Math.max(0, ...appliedAt);
  return { applied: appliedAt.length, pending: bundled.filter((m) => m.when > lastApplied) };
}

/** With ORDLER_MIGRATE=false a DBA applies migrations; until then the app must not serve. */
export function assertNoPendingMigrations(pending: readonly BundledMigration[]): void {
  if (pending.length > 0) {
    throw new PendingMigrationsError(
      `Database schema is behind this Ordler version: ${pending.map((m) => m.tag).join(', ')} pending. ` +
        'Apply them with `ordler migrate` or start with ORDLER_MIGRATE=true.',
    );
  }
}
