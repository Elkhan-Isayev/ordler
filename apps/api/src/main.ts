import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { AppModule } from './app.module.js';
import { describeConfig, loadConfig } from './config/env.js';
import { createSchemaSql, MIGRATION_LOCK_KEY, withAdvisoryLock } from './db/migrate.js';
import { toPoolConfig } from './db/pool-config.js';
import { DatabaseReadiness } from './db/readiness.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const config = loadConfig(process.env);
  logger.log(`Starting Ordler ${JSON.stringify(describeConfig(config))}`);

  const pool = new pg.Pool(toPoolConfig(config.database));
  const readiness = new DatabaseReadiness(pool);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot({
      readiness,
      // Authentication lands in the next increment; until then no member has any grants.
      access: {
        load: async () => ({
          assignments: [],
          rolePermissions: () => undefined,
          directory: { departmentOfTeam: () => undefined },
        }),
      },
    }),
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');

  if (config.migrateOnStart) {
    const client = await pool.connect();
    try {
      await withAdvisoryLock(client, MIGRATION_LOCK_KEY, async () => {
        await client.query(createSchemaSql(config.database.schema));
        await migrate(drizzle(client), {
          migrationsFolder: MIGRATIONS_FOLDER,
          migrationsSchema: config.database.schema,
        });
      });
    } finally {
      client.release();
    }
    logger.log('Database migrations are up to date');
  }
  readiness.markMigrated();
  logger.log(`Listening on port ${config.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
