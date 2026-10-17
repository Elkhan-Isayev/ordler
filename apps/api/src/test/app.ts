import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createAppContext, type AppContext, type AppContextDeps } from '../app-context.js';
import { AppModule, configureApp } from '../app.module.js';
import { MemoryMailer } from '../mail/mailer.js';
import { syncSystemRoles } from '../setup/system-roles.js';
import { FAST_ARGON2 } from './fixtures.js';
import { createTestDatabase, type TestDatabase } from './pglite.js';

export const TEST_BASE_URL = 'https://ordler.test';

export interface TestApp {
  app: NestFastifyApplication;
  ctx: AppContext;
  mailer: MemoryMailer;
  database: TestDatabase;
  close(): Promise<void>;
}

/** The production module and hooks on a fresh PGlite database. */
export async function createTestApp(overrides: Partial<AppContextDeps> = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  const mailer = new MemoryMailer();
  const ctx = createAppContext({
    db: database.db,
    baseUrl: TEST_BASE_URL,
    encryptionKey: randomBytes(32),
    sessionTtlDays: 30,
    // Mail counts as configured, and every message lands in `mailer`.
    smtp: {
      host: 'smtp.ordler.test',
      port: 587,
      security: 'starttls',
      verifyTls: true,
      from: 'Ordler <no-reply@ordler.test>',
    },
    mailTransport: () => mailer,
    databaseSettings: {
      source: 'env',
      current: {
        host: 'db.ordler.test',
        port: 5432,
        database: 'ordler',
        user: 'ordler',
        password: 'db-secret',
        schema: 'ordler',
        ssl: 'disable',
        poolMax: 20,
      },
      probe: async () => ({ ok: true, serverVersion: '18.1' }),
      save: () => undefined,
    },
    readiness: { isReady: async () => true },
    argon2: FAST_ARGON2,
    ...overrides,
  });
  await syncSystemRoles(database.db);
  await ctx.strategies.ensureDefaults();

  const ref = await Test.createTestingModule({ imports: [AppModule.forRoot(ctx)] }).compile();
  const app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app, ctx);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    ctx,
    mailer,
    database,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

/** Extracts `name=value` for a cookie from Set-Cookie headers, ready for a Cookie header. */
export function cookieFrom(setCookie: string | string[] | undefined, name: string): string {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = all.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) throw new Error(`No ${name} cookie in ${JSON.stringify(all)}`);
  return match.split(';')[0]!;
}
