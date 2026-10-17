import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  databaseSettingsSchema,
  installDatabaseSchema,
  type DatabaseProbeError,
  type DatabaseProbeResult,
  type DatabaseSettingsInput,
  type SetupStatusResponse,
} from '@ordler/shared';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { RateLimiter } from '../auth/rate-limiter.js';
import type { DatabaseConfig } from '../config/env.js';
import { registerWebAssets } from '../http/web-assets.js';

export interface InstallerOptions {
  baseUrl: string;
  /** One-time token printed in the log; only someone with log access can install. */
  token: string;
  webDir: string | undefined;
  poolMax: number;
  probe: (config: DatabaseConfig) => Promise<DatabaseProbeResult>;
  /** Persists the settings (data volume); called only after a successful probe. */
  save: (input: DatabaseSettingsInput) => void;
  /** Why previously saved settings no longer work; shown on the installer page. */
  initialError?: DatabaseProbeError | undefined;
}

/** Readable install token, e.g. `K7QX-2M9P-WD4T`. */
export function generateInstallToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [...randomBytes(12)].map((byte) => alphabet[byte % alphabet.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

export function toDatabaseConfig(input: DatabaseSettingsInput, poolMax: number): DatabaseConfig {
  return {
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.user,
    ...(input.password ? { password: input.password } : {}),
    schema: input.schema,
    ssl: input.ssl,
    ...(input.sslCa ? { sslCa: input.sslCa } : {}),
    poolMax,
  };
}

/**
 * First-run installer (SPEC §16.4): with no database configured, Ordler serves only this
 * small API plus the web app, which asks for the PostgreSQL connection. `onConfigured` fires
 * once valid settings are saved, so the caller can start the real application.
 */
export async function buildInstaller(
  options: InstallerOptions,
  onConfigured: (config: DatabaseConfig) => void,
): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy: true });
  const limiter = new RateLimiter(20, 15 * 60_000);
  const allowedOrigin = new URL(options.baseUrl).origin;
  let configured = false;

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => reply.status(503).send({ status: 'not_ready' }));

  app.get('/api/setup/status', async (): Promise<SetupStatusResponse> => ({
    setupRequired: true,
    databaseRequired: true,
    ...(options.initialError ? { databaseError: options.initialError } : {}),
  }));

  async function guarded(
    request: { body: unknown; ip: string; headers: { origin?: string | undefined } },
    reply: FastifyReply,
  ): Promise<DatabaseConfig | undefined> {
    if (request.headers.origin && request.headers.origin !== allowedOrigin) {
      await reply.status(403).send({ error: 'forbidden_origin' });
      return undefined;
    }
    if (!limiter.attempt(request.ip)) {
      await reply.status(429).send({ error: 'rate_limited' });
      return undefined;
    }
    const parsed = installDatabaseSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.status(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return undefined;
    }
    if (!sameToken(parsed.data.installToken, options.token)) {
      await reply.status(403).send({ error: 'invalid_install_token' });
      return undefined;
    }
    return toDatabaseConfig(parsed.data, options.poolMax);
  }

  app.post('/api/install/database/test', async (request, reply) => {
    const config = await guarded(request, reply);
    if (!config) return reply;
    return options.probe(config);
  });

  app.post('/api/install/database', async (request, reply) => {
    const config = await guarded(request, reply);
    if (!config) return reply;
    if (configured) return reply.status(409).send({ error: 'setup_completed' });
    const result = await options.probe(config);
    if (!result.ok) return result;
    // The plain settings schema drops the install token before it reaches the disk.
    const settings = databaseSettingsSchema.parse(request.body);
    options.save(settings);
    configured = true;
    // Answer first; the caller then swaps this server for the real application.
    reply.raw.once('finish', () => onConfigured(config));
    return result;
  });

  app.all('/api/*', async (_request, reply) =>
    reply.status(503).send({ error: 'database_required' }),
  );

  await registerWebAssets(app, options.webDir);
  return app;
}

/** Runs the installer on `port` until the database is configured, then frees the port. */
export async function runInstaller(
  options: InstallerOptions & { port: number; log: (message: string) => void },
): Promise<DatabaseConfig> {
  let resolveConfigured!: (config: DatabaseConfig) => void;
  const done = new Promise<DatabaseConfig>((resolve) => {
    resolveConfigured = resolve;
  });
  const app = await buildInstaller(options, resolveConfigured);
  await app.listen({ port: options.port, host: '0.0.0.0' });
  options.log(installBanner(options.baseUrl, options.token));

  const config = await done;
  await app.close();
  return config;
}

export function installBanner(baseUrl: string, token: string): string {
  const line = '='.repeat(64);
  return [
    '',
    line,
    '  Ordler needs a PostgreSQL database.',
    `  Open ${baseUrl} and enter the install token:`,
    '',
    `      ${token}`,
    '',
    '  Prepare an empty database first, e.g.:',
    "    CREATE USER ordler WITH PASSWORD '...';",
    '    CREATE DATABASE ordler OWNER ordler;',
    line,
    '',
  ].join('\n');
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(expected.trim().toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
