import { createReadStream } from 'node:fs';
import { cp, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Serves the whiteboard editor's fonts from Ordler itself (ADR 0015): on-prem installs may
 * have no internet, and the editor would otherwise fetch them from a public CDN.
 */
function whiteboardFonts(): Plugin {
  const fonts = join(
    dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')),
    'fonts',
  );
  return {
    name: 'ordler-whiteboard-fonts',
    configureServer(server) {
      server.middlewares.use('/excalidraw-assets/fonts', (request, response, next) => {
        const file = normalize(join(fonts, decodeURIComponent(request.url?.split('?')[0] ?? '')));
        if (!file.startsWith(fonts)) return next();
        stat(file).then(
          (info) => {
            if (!info.isFile()) return next();
            response.setHeader(
              'content-type',
              file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream',
            );
            createReadStream(file).pipe(response);
          },
          () => next(),
        );
      });
    },
    async writeBundle(options) {
      if (options.dir)
        await cp(fonts, join(options.dir, 'excalidraw-assets', 'fonts'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), whiteboardFonts()],
  resolve: {
    alias: {
      '@ordler/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    // ORDLER_API_URL lets a second dev setup run side by side (e.g. API on :3001).
    proxy: {
      // ws: the realtime channel (/api/realtime) is a WebSocket.
      '/api': { target: process.env.ORDLER_API_URL ?? 'http://localhost:3000', ws: true },
      '/mcp': process.env.ORDLER_API_URL ?? 'http://localhost:3000',
      // OAuth discovery for MCP clients (ADR 0014).
      '/.well-known/oauth-': process.env.ORDLER_API_URL ?? 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
