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
import { DataDir } from './config/data-dir.js';
import { describeConfig, loadConfig, type AppConfig, type DatabaseConfig } from './config/env.js';
import { SecretBox } from './crypto/secret-box.js';
import type { Db } from './db/client.js';
import { DEFAULT_SCHEMA, resolveDefaultSchema } from './db/schema-default.js';
import { createSchemaSql, MIGRATION_LOCK_KEY, withAdvisoryLock } from './db/migrate.js';
import { probeDatabase } from './db/probe.js';
import {
  assertNoPendingMigrations,
  checkSchemaCompatibility,
  readJournal,
} from './db/schema-compat.js';
import { toPoolConfig } from './db/pool-config.js';
import { DatabaseReadiness } from './db/readiness.js';
import * as schema from './db/schema.js';
import { cachedSite } from './http/link-preview.js';
import { DEFAULT_WEB_DIR, registerWebAssets } from './http/web-assets.js';
import { generateInstallToken, runInstaller } from './install/installer.js';
import { ensureAllTeamWorkflows } from './issues/workflows.js';
import { PgEventBus } from './realtime/event-bus.js';
import { syncSystemRoles } from './setup/system-roles.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const config = loadConfig(process.env);
  logger.log(`Starting Ordler ${JSON.stringify(describeConfig(config))}`);

  const dataDir = new DataDir(config.dataDir);
  const encryptionKey = config.encryptionKey ?? generatedKey(dataDir, logger);
  const box = new SecretBox(encryptionKey);
  const webDir = config.webDir ?? DEFAULT_WEB_DIR;

  let database = config.database;
  const source = database ? 'env' : 'file';
  if (!database) {
    const saved = dataDir.readDatabase(box, config.dbPoolMax);
    const check = saved ? await probeDatabase(saved) : undefined;
    if (saved && check?.ok) {
      database = saved;
    } else {
      if (check && !check.ok) {
        logger.error(`Saved database settings do not work (${check.error}): ${check.detail ?? ''}`);
      }
      // No database yet (or it stopped working): serve the installer until one is saved.
      database = await runInstaller({
        port: config.port,
        baseUrl: config.baseUrl,
        token: config.installToken ?? generateInstallToken(),
        webDir,
        poolMax: config.dbPoolMax,
        probe: (candidate) => probeDatabase(candidate),
        save: (input) => dataDir.writeDatabase(box, input),
        initialError: check && !check.ok ? check.error : undefined,
        log: (message) => logger.log(message),
      });
      logger.log(`Database settings saved to ${dataDir.path}`);
    }
  }

  await startApplication(config, database, source, { encryptionKey, box, dataDir, webDir }, logger);
}

async function startApplication(
  config: AppConfig,
  database: DatabaseConfig,
  source: 'env' | 'file',
  storage: { encryptionKey: Buffer; box: SecretBox; dataDir: DataDir; webDir: string },
  logger: Logger,
): Promise<void> {
  if (database.schemaFromDefault) {
    database = { ...database, schema: await pickDefaultSchema(database), schemaFromDefault: false };
    if (database.schema !== DEFAULT_SCHEMA) {
      logger.log(`Using schema "${database.schema}", where this installation's data already is`);
    }
  }
  const pool = new pg.Pool(toPoolConfig(database));
  const db = drizzle(pool, { schema }) as unknown as Db;
  const readiness = new DatabaseReadiness(pool);
  // The listener needs one dedicated connection with the same settings as the pool.
  const events = new PgEventBus(pool, toPoolConfig(database), (message) => logger.warn(message));
  const ctx = createAppContext({
    events,
    db,
    baseUrl: config.baseUrl,
    encryptionKey: storage.encryptionKey,
    sessionTtlDays: config.sessionTtlDays,
    smtp: config.smtp,
    attachmentMaxBytes: config.attachmentMaxBytes,
    readiness,
    version: config.version,
    updateCheck: config.updateCheck,
    databaseSettings: {
      source,
      current: database,
      probe: (candidate) => probeDatabase(candidate),
      save: (input) => storage.dataDir.writeDatabase(storage.box, input),
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(ctx),
    new FastifyAdapter({ trustProxy: true }),
  );
  await configureApp(app, ctx);
  if (
    await registerWebAssets(app.getHttpAdapter().getInstance(), storage.webDir, {
      baseUrl: config.baseUrl,
      site: cachedSite(db),
    })
  ) {
    logger.log(`Serving the web app from ${storage.webDir}`);
  }
  app.enableShutdownHooks();
  // Listen before migrating so liveness probes pass; /readyz stays 503 until migrations finish.
  await app.listen(config.port, '0.0.0.0');

  const bundled = readJournal(MIGRATIONS_FOLDER);
  const client = await pool.connect();
  try {
    await withAdvisoryLock(client, MIGRATION_LOCK_KEY, async () => {
      // Refuses a schema written by a newer Ordler before touching anything (no downgrades).
      const { pending } = await checkSchemaCompatibility(client, database.schema, bundled);
      if (!config.migrateOnStart) return assertNoPendingMigrations(pending);
      if (pending.length === 0) return;
      logger.log(
        `Applying ${pending.length} migration(s): ${pending.map((m) => m.tag).join(', ')}`,
      );
      await client.query(createSchemaSql(database.schema));
      // All pending migrations run in one transaction: a failure leaves the database unchanged.
      await migrate(drizzle(client), {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: database.schema,
      });
    });
  } finally {
    client.release();
  }
  logger.log('Database schema is up to date');
  await syncSystemRoles(db);
  await ctx.strategies.ensureDefaults();
  await ensureAllTeamWorkflows(db);
  await events.start();
  readiness.markMigrated();
  if (config.role !== 'web') {
    ctx.updates.start();
    ctx.cycles.start(undefined, (message) => logger.warn(message));
    ctx.imports.startRunner(undefined, (message) => logger.warn(message));
    ctx.webhooks.startRunner();
    ctx.sla.startRunner();
    ctx.requests.startTimeouts(undefined, (message) => logger.warn(message));
  }
  logger.log(`Listening on port ${config.port}`);
}

/** One short connection to see whether an older installation lives in the `ordler` schema. */
async function pickDefaultSchema(database: DatabaseConfig): Promise<string> {
  const client = new pg.Client(toPoolConfig({ ...database, schema: DEFAULT_SCHEMA }));
  await client.connect();
  try {
    return await resolveDefaultSchema(client);
  } finally {
    await client.end();
  }
}

function generatedKey(dataDir: DataDir, logger: Logger): Buffer {
  const { key, created } = dataDir.encryptionKey();
  if (created) {
    logger.warn(
      `Generated an encryption key in ${dataDir.path}/encryption.key. Back it up with the ` +
        'database: without it stored secrets (SMTP, Google, database password) are lost.',
    );
  }
  return key;
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
