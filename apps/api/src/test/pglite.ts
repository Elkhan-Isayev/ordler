import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from '../db/client.js';
import * as schema from '../db/schema.js';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface TestDatabase {
  db: Db;
  close(): Promise<void>;
}

/**
 * Real PostgreSQL 18 (PGlite, in-process WASM) with all migrations applied. Runs everywhere,
 * including CI without Docker; Testcontainers suites cover network and TLS behaviour.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}
