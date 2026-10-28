import { SUPPORTED_LOCALES } from '@ordler/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { completeSetup } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { PREVIEW_MESSAGES, cachedSite, injectPreview, linkPreview } from './link-preview.js';

const SITE = { companyName: 'Push30', locale: 'en' as const };
const BASE = 'https://ordler.push30.test/';

describe('linkPreview', () => {
  it('names an issue by its identifier and company, without any content', () => {
    expect(linkPreview('/issue/help-12?tab=activity', SITE, BASE)).toEqual({
      title: 'HELP-12 · Push30',
      description: 'Sign in to Push30 on Ordler to see this issue.',
      url: 'https://ordler.push30.test/issue/help-12',
      image: 'https://ordler.push30.test/icon-512.png',
    });
  });

  it('names requests and request groups', () => {
    expect(linkPreview('/requests/req-7', SITE, BASE).title).toBe('REQ-7 · Push30');
    expect(linkPreview('/request-groups/REQ-G-3', SITE, BASE).description).toBe(
      'Sign in to Push30 on Ordler to see this request.',
    );
  });

  it('falls back to the company card for other pages', () => {
    const preview = linkPreview('/teams/HELP/board', SITE, BASE);
    expect(preview.title).toBe('Push30');
    expect(preview.description).toBe('Tasks and requests of Push30 on Ordler.');
  });

  it('uses the workspace language', () => {
    expect(linkPreview('/requests/REQ-7', { ...SITE, locale: 'ru' }, BASE).description).toBe(
      'Войдите в Push30 в Ordler, чтобы увидеть запрос.',
    );
  });

  it('has copy in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const path of ['/issue/A-1', '/requests/REQ-1', '/']) {
        expect(linkPreview(path, { ...SITE, locale }, BASE).description).toContain('Push30');
      }
      expect(PREVIEW_MESSAGES[locale].description).toBeTruthy();
    }
  });
});

describe('injectPreview', () => {
  it('adds escaped Open Graph tags before </head>', () => {
    const html = injectPreview(
      '<html><head><title>Ordler</title></head><body></body></html>',
      linkPreview('/', { ...SITE, companyName: 'A&B "<Co>"' }, BASE),
    );
    expect(html).toContain('<meta property="og:title" content="A&amp;B &quot;&lt;Co&gt;&quot;" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://ordler.push30.test/icon-512.png" />',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'));
    expect(html).not.toContain('<Co>');
  });
});

describe('cachedSite', () => {
  let test: TestDatabase | undefined;
  afterEach(() => test?.close());

  it('is empty before setup and caches the company for a minute', async () => {
    test = await createTestDatabase();
    let now = 0;
    const site = cachedSite(test.db, () => now);
    expect(await site()).toBeUndefined();

    await completeSetup(test.db);
    now = 30_000;
    expect(await site()).toBeUndefined();
    now = 61_000;
    expect(await site()).toEqual({ companyName: 'Push30', locale: 'en' });
  });
});
