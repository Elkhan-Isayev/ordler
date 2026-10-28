import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerWebAssets } from './web-assets.js';

let dir: string;
let app: FastifyInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ordler-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  );
  writeFileSync(join(dir, 'assets', 'app-3f2a.js'), 'console.log(1)');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  app = Fastify();
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('registerWebAssets', () => {
  it('serves hashed assets with long caching and other files without', async () => {
    expect(await registerWebAssets(app, dir)).toBe(true);
    const asset = await app.inject({ url: '/assets/app-3f2a.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject({ url: '/favicon.svg' })).headers['cache-control']).toBe('no-cache');
  });

  it('answers client-side routes with index.html', async () => {
    await registerWebAssets(app, dir);
    const page = await app.inject({ url: '/admin/members' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('id="root"');
  });

  it('adds a link preview to the shell once setup is done', async () => {
    const setup: { site?: { companyName: string; locale: 'en' } } = {};
    await registerWebAssets(app, dir, {
      baseUrl: 'https://ordler.test',
      site: async () => setup.site,
    });
    expect((await app.inject({ url: '/requests/REQ-7' })).body).not.toContain('og:title');

    setup.site = { companyName: 'Push30', locale: 'en' };
    const page = await app.inject({ url: '/requests/REQ-7' });
    expect(page.body).toContain('<meta property="og:title" content="REQ-7 · Push30" />');
    expect(page.body).toContain('id="root"');
  });

  it('serves the plain shell when the preview lookup fails', async () => {
    await registerWebAssets(app, dir, {
      baseUrl: 'https://ordler.test',
      site: () => Promise.reject(new Error('db down')),
    });
    const page = await app.inject({ url: '/issue/HELP-1' });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('og:title');
  });

  it('keeps unknown API paths as JSON 404s', async () => {
    await registerWebAssets(app, dir);
    const missing = await app.inject({ url: '/api/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
  });

  it('does nothing without a build', async () => {
    expect(await registerWebAssets(app, join(dir, 'missing'))).toBe(false);
    expect(await registerWebAssets(app, undefined)).toBe(false);
  });
});
