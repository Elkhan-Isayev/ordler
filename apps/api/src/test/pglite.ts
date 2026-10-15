import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from '../db/client.js';
import * as schema from '../db/schema.js';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Same layout as production: tables live in their own schema selected by search_path. */
const TEST_SCHEMA = 'ordler';
const SEARCH_PATH = `set search_path to ${TEST_SCHEMA}, public`;

export interface TestDatabase {
  db: Db;
  close(): Promise<void>;
}

/** Migrated once per test worker; each test starts from a copy of this snapshot. */
let template: Promise<File | Blob> | undefined;

function migratedTemplate(): Promise<File | Blob> {
  template ??= (async () => {
    const client = new PGlite();
    await client.exec(`create schema ${TEST_SCHEMA}; ${SEARCH_PATH};`);
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: MIGRATIONS,
      migrationsSchema: TEST_SCHEMA,
    });
    const snapshot = await client.dumpDataDir('none');
    await client.close();
    return snapshot;
  })();
  return template;
}

/**
 * Real PostgreSQL 18 (PGlite, in-process WASM) with all migrations applied. Runs everywhere,
 * including CI without Docker; Testcontainers suites cover network and TLS behaviour.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite({ loadDataDir: await migratedTemplate() });
  await client.waitReady;
  await client.exec(SEARCH_PATH);
  const db = drizzle(client, { schema });
  return { db: db as unknown as Db, close: () => client.close() };
}
