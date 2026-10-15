import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { testClock } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import type { FetchFn } from './github.js';
import { CHECK_INTERVAL_MS, UpdateService } from './update.service.js';

let test: TestDatabase;
let db: Db;
let clock: ReturnType<typeof testClock>;
let releases: unknown[];
let respond: 'ok' | 'not_modified' | 'error';
let requests: number;

const fakeFetch: FetchFn = async () => {
  requests += 1;
  if (respond === 'error') throw new Error('getaddrinfo ENOTFOUND api.github.com');
  if (respond === 'not_modified') return new Response(null, { status: 304 });
  return new Response(JSON.stringify(releases), { status: 200, headers: { etag: 'W/"1"' } });
};

const release = (tag: string) => ({
  tag_name: tag,
  name: `Ordler ${tag}`,
  html_url: `https://github.com/Elkhan-Isayev/ordler/releases/tag/${tag}`,
  body: '## Changes',
  draft: false,
  prerelease: false,
  published_at: '2026-10-10T00:00:00Z',
});

function service(currentVersion: string | undefined, enabled = true) {
  return new UpdateService({
    db,
    enabled,
    repository: 'Elkhan-Isayev/ordler',
    currentVersion,
    fetch: fakeFetch,
    now: clock.now,
  });
}

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  clock = testClock();
  releases = [release('v1.3.0')];
  respond = 'ok';
  requests = 0;
});
afterEach(() => test.close());

describe('UpdateService', () => {
  it('announces a newer release to admins', async () => {
    const status = await service('1.2.0').check();
    expect(status).toMatchObject({
      currentVersion: '1.2.0',
      latestVersion: '1.3.0',
      updateAvailable: true,
      majorUpgrade: false,
      release: {
        name: 'Ordler v1.3.0',
        url: 'https://github.com/Elkhan-Isayev/ordler/releases/tag/v1.3.0',
      },
      lastError: null,
    });
    expect(status.checkedAt).toBe(clock.now().toISOString());
  });

  it('stays quiet when up to date or ahead', async () => {
    expect((await service('1.3.0').check()).updateAvailable).toBe(false);
    expect((await service('1.4.0').status()).updateAvailable).toBe(false);
  });

  it('flags major upgrades', async () => {
    releases = [release('v2.0.0')];
    expect(await service('1.9.3').check()).toMatchObject({
      updateAvailable: true,
      majorUpgrade: true,
    });
  });

  it('never notifies development builds', async () => {
    const status = await service(undefined).check();
    expect(status).toMatchObject({
      currentVersion: null,
      latestVersion: '1.3.0',
      updateAvailable: false,
    });
  });

  it('does nothing when disabled (air-gapped installs)', async () => {
    const status = await service('1.0.0', false).check();
    expect(requests).toBe(0);
    expect(status).toMatchObject({ enabled: false, updateAvailable: false });
  });

  it('keeps the last known release when a check fails', async () => {
    await service('1.2.0').check();
    respond = 'error';
    const status = await service('1.2.0').check();
    expect(status).toMatchObject({
      latestVersion: '1.3.0',
      updateAvailable: true,
      lastError: 'getaddrinfo ENOTFOUND api.github.com',
    });
  });

  it('keeps data on 304 Not Modified and clears the error', async () => {
    await service('1.2.0').check();
    respond = 'not_modified';
    clock.advance(1000);
    const status = await service('1.2.0').check();
    expect(status).toMatchObject({ latestVersion: '1.3.0', lastError: null });
    expect(status.checkedAt).toBe(clock.now().toISOString());
  });

  it('asks GitHub at most once a day', async () => {
    const updates = service('1.2.0');
    await updates.checkIfStale();
    await updates.checkIfStale();
    expect(requests).toBe(1);
    clock.advance(CHECK_INTERVAL_MS);
    await updates.checkIfStale();
    expect(requests).toBe(2);
  });

  it('reports nothing before the first check', async () => {
    expect(await service('1.2.0').status()).toMatchObject({
      latestVersion: null,
      updateAvailable: false,
      release: null,
      checkedAt: null,
    });
  });
});
