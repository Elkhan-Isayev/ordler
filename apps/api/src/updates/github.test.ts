import { describe, expect, it } from 'vitest';
import { fetchLatestRelease, type FetchFn } from './github.js';

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `Ordler ${tag}`,
  html_url: `https://github.com/Elkhan-Isayev/ordler/releases/tag/${tag}`,
  body: `Notes for ${tag}`,
  draft: false,
  prerelease: false,
  published_at: '2026-10-01T10:00:00Z',
  ...extra,
});

function fakeFetch(body: unknown, init: { status?: number; etag?: string } = {}) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn: FetchFn = async (url, request) => {
    requests.push({ url, headers: request.headers as Record<string, string> });
    return new Response(init.status === 304 ? null : JSON.stringify(body), {
      status: init.status ?? 200,
      headers: init.etag ? { etag: init.etag } : {},
    });
  };
  return { fn, requests };
}

describe('fetchLatestRelease', () => {
  it('picks the highest stable release, skipping drafts and pre-releases', async () => {
    const { fn, requests } = fakeFetch(
      [
        release('v1.3.0-rc.1', { prerelease: true }),
        release('v2.0.0', { draft: true }),
        release('v1.2.0'),
        release('v1.10.1'),
        release('not-a-version'),
        release('v1.4.0-beta'),
      ],
      { etag: 'W/"abc"' },
    );
    const result = await fetchLatestRelease({
      repository: 'Elkhan-Isayev/ordler',
      currentVersion: '1.2.0',
      fetch: fn,
    });
    expect(result).toMatchObject({
      status: 'ok',
      etag: 'W/"abc"',
      release: { tag: 'v1.10.1', name: 'Ordler v1.10.1', notes: 'Notes for v1.10.1' },
    });
    expect(requests[0]!.url).toBe(
      'https://api.github.com/repos/Elkhan-Isayev/ordler/releases?per_page=20',
    );
    expect(requests[0]!.headers['user-agent']).toBe('Ordler/1.2.0');
  });

  it('sends the ETag and reports not-modified', async () => {
    const { fn, requests } = fakeFetch(undefined, { status: 304 });
    const result = await fetchLatestRelease({
      repository: 'a/b',
      currentVersion: undefined,
      etag: 'W/"abc"',
      fetch: fn,
    });
    expect(result).toEqual({ status: 'not_modified' });
    expect(requests[0]!.headers['if-none-match']).toBe('W/"abc"');
  });

  it('returns no release for a repository without stable releases', async () => {
    const { fn } = fakeFetch([release('v0.1.0-alpha', { prerelease: true })]);
    expect(
      await fetchLatestRelease({ repository: 'a/b', currentVersion: '0.1.0', fetch: fn }),
    ).toMatchObject({
      status: 'ok',
      release: undefined,
    });
  });

  it('fails on GitHub errors such as rate limiting', async () => {
    const { fn } = fakeFetch({ message: 'rate limited' }, { status: 403 });
    await expect(
      fetchLatestRelease({ repository: 'a/b', currentVersion: '1.0.0', fetch: fn }),
    ).rejects.toThrow('GitHub responded 403');
  });

  it('truncates very long release notes', async () => {
    const { fn } = fakeFetch([release('v1.0.0', { body: 'x'.repeat(50_000) })]);
    const result = await fetchLatestRelease({
      repository: 'a/b',
      currentVersion: '0.9.0',
      fetch: fn,
    });
    expect(result.status === 'ok' && result.release?.notes.length).toBe(20_000);
  });
});
