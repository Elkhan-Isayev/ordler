import type { AboutResponse } from '@ordler/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/app.js';

let t: TestApp;
afterEach(() => t.close());

describe('GET /api/about (AGPL §13 source offer)', () => {
  it('is public and points at the published source by default', async () => {
    t = await createTestApp();
    const response = await t.app.inject({ method: 'GET', url: '/api/about' });
    expect(response.statusCode).toBe(200);
    expect(response.json<AboutResponse>()).toEqual({
      version: 'development',
      license: 'AGPL-3.0-only',
      sourceUrl: 'https://github.com/Elkhan-Isayev/ordler',
    });
  });

  it("reports the release version and a fork's own source", async () => {
    t = await createTestApp({ version: '1.2.3', sourceUrl: 'https://git.acme.test/it/ordler' });
    const about = (await t.app.inject({ method: 'GET', url: '/api/about' })).json<AboutResponse>();
    expect(about).toMatchObject({ version: '1.2.3', sourceUrl: 'https://git.acme.test/it/ordler' });
  });
});
