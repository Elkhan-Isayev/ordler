import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { injectPreview, linkPreview, type PreviewSite } from './link-preview.js';

export interface PreviewOptions {
  baseUrl: string;
  /** Undefined until setup is complete; no preview tags are added then. */
  site: () => Promise<PreviewSite | undefined>;
}

/** Where the image puts the built web app (apps/web/dist copied next to the API). */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../public', import.meta.url));

/**
 * Serves the built single-page app from the same origin as the API: hashed assets are cached
 * forever, every other non-API path returns index.html so client-side routes survive a reload.
 * With `preview`, the shell carries link-preview tags for messengers (see link-preview.ts).
 * Returns false when no build is present (development, where Vite serves the app).
 */
export async function registerWebAssets(
  instance: FastifyInstance,
  dir: string | undefined,
  preview?: PreviewOptions,
): Promise<boolean> {
  if (!dir || !existsSync(join(dir, 'index.html'))) return false;
  const indexHtml = readFileSync(join(dir, 'index.html'), 'utf8');

  await instance.register(fastifyStatic, {
    root: dir,
    wildcard: false,
    index: false,
    setHeaders: (response, path) => {
      response.header(
        'cache-control',
        path.includes(`${join(dir, 'assets')}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });

  instance.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url === '/api') {
      return reply.status(404).send({ error: 'not_found' });
    }
    const site = await preview?.site().catch(() => undefined);
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(
        site
          ? injectPreview(indexHtml, linkPreview(request.url, site, preview!.baseUrl))
          : indexHtml,
      );
  });
  return true;
}
