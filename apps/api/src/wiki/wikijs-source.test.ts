import { describe, expect, it } from 'vitest';
import { recordedFetch } from '../imports/sources/fake-http.js';
import { localReferences, pagePathOf, rewriteTargets, WikiJsSource } from './wikijs-source.js';

describe('WikiJsSource', () => {
  it('sends the key as a bearer token to the GraphQL endpoint of the wiki origin', async () => {
    const { fetch, calls } = recordedFetch([
      {
        json: {
          data: {
            pages: {
              list: [
                {
                  id: 7,
                  path: 'docs/a',
                  locale: 'en',
                  title: '',
                  updatedAt: '2025-01-01T00:00:00Z',
                },
              ],
            },
          },
        },
      },
    ]);
    const pages = await new WikiJsSource('https://wiki.example.test/en/home', 'key', fetch).pages();
    expect(calls[0]!.url).toBe('https://wiki.example.test/graphql');
    expect(calls[0]!.headers.authorization).toBe('Bearer key');
    expect(pages).toEqual([
      { id: 7, path: 'docs/a', locale: 'en', title: 'a', updatedAt: '2025-01-01T00:00:00Z' },
    ]);
  });

  it('reports a forbidden key as an authentication error', async () => {
    const { fetch } = recordedFetch([{ json: { errors: [{ message: 'Forbidden' }] } }]);
    await expect(new WikiJsSource('https://w.test', 'bad', fetch).pages()).rejects.toMatchObject({
      code: 'import_auth_failed',
    });
  });

  it('downloads files only from the wiki itself', async () => {
    const { fetch, calls } = recordedFetch([
      { body: 'png', headers: { 'content-type': 'image/png' } },
    ]);
    const source = new WikiJsSource('https://w.test', 'key', fetch);
    expect((await source.download('/uploads/a.png')).contentType).toBe('image/png');
    expect(calls[0]!.url).toBe('https://w.test/uploads/a.png');
    await expect(source.download('https://evil.test/a.png')).rejects.toMatchObject({
      code: 'import_source_failed',
    });
    await expect(source.download('//evil.test/a.png')).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
  });
});

describe('Wiki.js link helpers', () => {
  const markdown =
    '![d](/uploads/d.png =300x) [Setup](/en/guides/setup#install "Guide") [ext](https://x.test/a.png) [proto](//cdn.test/x.png)';

  it('finds links into the wiki and tells files from pages', () => {
    expect(localReferences(markdown)).toEqual([
      { target: '/uploads/d.png', isFile: true },
      { target: '/en/guides/setup#install', isFile: false },
    ]);
  });

  it('rewrites only the targets it resolves and drops Wiki.js image sizes', () => {
    expect(
      rewriteTargets(markdown, (target) =>
        target === '/uploads/d.png' ? '/api/attachments/1/d.png' : undefined,
      ),
    ).toBe(
      '![d](/api/attachments/1/d.png) [Setup](/en/guides/setup#install "Guide") [ext](https://x.test/a.png) [proto](//cdn.test/x.png)',
    );
  });

  it('reads a page path from a link with or without the locale', () => {
    const locales = new Set(['en', 'ru']);
    expect(pagePathOf('/en/guides/setup#install', locales)).toBe('guides/setup');
    expect(pagePathOf('/guides/setup/', locales)).toBe('guides/setup');
    expect(pagePathOf('/ru', locales)).toBe('ru');
    expect(pagePathOf('/en/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82', locales)).toBe('привет');
  });
});
