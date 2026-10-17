import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseProbeResult, DatabaseSettingsInput } from '@ordler/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseConfig } from '../config/env.js';
import { buildInstaller, generateInstallToken, installBanner } from './installer.js';

const TOKEN = 'K7QX-2M9P-WD4T';
const BASE_URL = 'https://tasks.push30.test';

const BODY = {
  host: 'db.push30.test',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  password: 'db-secret',
  ssl: 'require',
  schema: 'ordler',
  installToken: TOKEN,
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function installer(
  options: {
    probe?: (config: DatabaseConfig) => Promise<DatabaseProbeResult>;
    webDir?: string;
    initialError?: 'authentication_failed';
  } = {},
) {
  const saved: DatabaseSettingsInput[] = [];
  const configured = vi.fn();
  app = await buildInstaller(
    {
      baseUrl: BASE_URL,
      token: TOKEN,
      webDir: options.webDir,
      poolMax: 20,
      probe: options.probe ?? (async () => ({ ok: true, serverVersion: '18.1' })),
      save: (input) => saved.push(input),
      initialError: options.initialError,
    },
    configured,
  );
  return { saved, configured };
}

const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  app!.inject({ method: 'POST', url, payload, headers });

describe('installer', () => {
  it('tells the web app that a database is required', async () => {
    await installer({ initialError: 'authentication_failed' });
    expect((await app!.inject({ url: '/api/setup/status' })).json()).toEqual({
      setupRequired: true,
      databaseRequired: true,
      databaseError: 'authentication_failed',
    });
    expect((await app!.inject({ url: '/readyz' })).json()).toEqual({ status: 'installing' });
    expect((await app!.inject({ url: '/healthz' })).statusCode).toBe(200);
    expect((await app!.inject({ url: '/api/me' })).json()).toEqual({ error: 'database_required' });
  });

  it('tests a connection without saving it', async () => {
    const { saved, configured } = await installer();
    const result = await post('/api/install/database/test', BODY);
    expect(result.json()).toEqual({ ok: true, serverVersion: '18.1' });
    expect(saved).toHaveLength(0);
    expect(configured).not.toHaveBeenCalled();
  });

  it('saves working settings and hands over to the application', async () => {
    const probe = vi.fn(async () => ({ ok: true as const, serverVersion: '18.1' }));
    const { saved, configured } = await installer({ probe });
    const result = await post('/api/install/database', BODY);
    expect(result.statusCode).toBe(200);
    expect(saved).toEqual([
      {
        host: 'db.push30.test',
        port: 5432,
        database: 'ordler',
        user: 'ordler',
        password: 'db-secret',
        ssl: 'require',
        schema: 'ordler',
      },
    ]);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'db.push30.test', poolMax: 20 }),
    );
    await vi.waitFor(() => expect(configured).toHaveBeenCalledOnce());
    expect((await post('/api/install/database', BODY)).statusCode).toBe(409);
  });

  it('does not save settings that fail the probe', async () => {
    const { saved } = await installer({
      probe: async () => ({ ok: false, error: 'postgres_too_old', detail: 'PostgreSQL 16.4' }),
    });
    const result = await post('/api/install/database', BODY);
    expect(result.json()).toEqual({
      ok: false,
      error: 'postgres_too_old',
      detail: 'PostgreSQL 16.4',
    });
    expect(saved).toHaveLength(0);
  });

  it('requires the install token from the log', async () => {
    const { saved } = await installer();
    const wrong = await post('/api/install/database', { ...BODY, installToken: 'AAAA-BBBB-CCCC' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'invalid_install_token' });
    const missing = await post('/api/install/database/test', { ...BODY, installToken: undefined });
    expect(missing.statusCode).toBe(400);
    expect(saved).toHaveLength(0);
    // Case and surrounding spaces do not matter when typing the token.
    expect(
      (await post('/api/install/database/test', { ...BODY, installToken: ' k7qx-2m9p-wd4t ' }))
        .statusCode,
    ).toBe(200);
  });

  it('rejects cross-site requests', async () => {
    await installer();
    const result = await post('/api/install/database', BODY, { origin: 'https://evil.test' });
    expect(result.statusCode).toBe(403);
  });

  it('serves the web app so the installer page can load', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'ordler-web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Ordler</title>');
    try {
      await installer({ webDir });
      const page = await app!.inject({ url: '/' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>Ordler</title>');
    } finally {
      rmSync(webDir, { recursive: true, force: true });
    }
  });
});

describe('generateInstallToken', () => {
  it('is readable and random', () => {
    const token = generateInstallToken();
    expect(token).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(generateInstallToken()).not.toBe(token);
  });

  it('is printed with the URL to open', () => {
    expect(installBanner(BASE_URL, TOKEN)).toContain(`Open ${BASE_URL}`);
    expect(installBanner(BASE_URL, TOKEN)).toContain(TOKEN);
  });
});
