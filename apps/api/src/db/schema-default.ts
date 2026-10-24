import type { LockClient } from './migrate.js';

/** New installations keep their tables in `public`, like Wiki.js. */
export const DEFAULT_SCHEMA = 'public';
/** The default before 0.3: installations created then keep using it. */
export const LEGACY_SCHEMA = 'ordler';

/**
 * Picks the schema when none was configured explicitly. An installation that was created with
 * the old default already has its migrations in `ordler`; moving it to an empty `public` would
 * look like data loss, so it stays where its data is.
 */
export async function resolveDefaultSchema(client: LockClient): Promise<string> {
  const result = (await client.query(
    `select table_schema from information_schema.tables
      where table_name = '__drizzle_migrations' and table_schema in ($1, $2)`,
    [DEFAULT_SCHEMA, LEGACY_SCHEMA],
  )) as { rows: Array<{ table_schema: string }> };
  const found = new Set(result.rows.map((row) => row.table_schema));
  return found.has(LEGACY_SCHEMA) && !found.has(DEFAULT_SCHEMA) ? LEGACY_SCHEMA : DEFAULT_SCHEMA;
}
