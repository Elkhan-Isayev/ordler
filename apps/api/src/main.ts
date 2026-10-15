import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createAppContext } from './app-context.js';
import { AppModule, configureApp } from './app.module.js';
import { describeConfig, loadConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { createSchemaSql, MIGRATION_LOCK_KEY, withAdvisoryLock } from './db/migrate.js';
import {
  assertNoPendingMigrations,
  checkSchemaCompatibility,
  readJournal,
} from './db/schema-compat.js';
import { toPoolConfig } from './db/pool-config.js';
import { DatabaseReadiness } from './db/readiness.js';
import * as schema from './db/schema.js';
import { SmtpMailer } from './mail/mailer.js';
import { syncSystemRoles } from './setup/system-roles.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const config = loadConfig(process.env);
  logger.log(`Starting Ordler ${JSON.stringify(describeConfig(config))}`);

  const pool = new pg.Pool(toPoolConfig(config.database));
  const db = drizzle(pool, { schema }) as unknown as Db;
  const readiness = new DatabaseReadiness(pool);
  const ctx = createAppContext({
    db,
    baseUrl: config.baseUrl,
    encryptionKey: config.encryptionKey,
    sessionTtlDays: config.sessionTtlDays,
    mailer: config.smtp ? new SmtpMailer(config.smtp) : undefined,
    readiness,
    version: config.version,
    updateCheck: config.updateCheck,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(ctx),
    new FastifyAdapter({ trustProxy: true }),
  );
  configureApp(app, ctx);
  app.enableShutdownHooks();
  // Listen before migrating so liveness probes pass; /readyz stays 503 until migrations finish.
  await app.listen(config.port, '0.0.0.0');

  const bundled = readJournal(MIGRATIONS_FOLDER);
  const client = await pool.connect();
  try {
    await withAdvisoryLock(client, MIGRATION_LOCK_KEY, async () => {
      // Refuses a schema written by a newer Ordler before touching anything (no downgrades).
      const { pending } = await checkSchemaCompatibility(client, config.database.schema, bundled);
      if (!config.migrateOnStart) return assertNoPendingMigrations(pending);
      if (pending.length === 0) return;
      logger.log(
        `Applying ${pending.length} migration(s): ${pending.map((m) => m.tag).join(', ')}`,
      );
      await client.query(createSchemaSql(config.database.schema));
      // All pending migrations run in one transaction: a failure leaves the database unchanged.
      await migrate(drizzle(client), {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: config.database.schema,
      });
    });
  } finally {
    client.release();
  }
  logger.log('Database schema is up to date');
  await syncSystemRoles(db);
  await ctx.strategies.ensureDefaults();
  readiness.markMigrated();
  if (config.role !== 'web') ctx.updates.start();
  logger.log(`Listening on port ${config.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
