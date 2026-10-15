import { describe, expect, it } from 'vitest';
import { DatabaseReadiness } from './readiness.js';

describe('DatabaseReadiness', () => {
  it('is not ready before migrations finish', async () => {
    const readiness = new DatabaseReadiness({ query: async () => ({}) });
    expect(await readiness.isReady()).toBe(false);
  });

  it('is ready after migrations when the database answers', async () => {
    const readiness = new DatabaseReadiness({ query: async () => ({}) });
    readiness.markMigrated();
    expect(await readiness.isReady()).toBe(true);
  });

  it('is not ready when the database is unreachable', async () => {
    const readiness = new DatabaseReadiness({
      query: async () => Promise.reject(new Error('ECONNREFUSED')),
    });
    readiness.markMigrated();
    expect(await readiness.isReady()).toBe(false);
  });
});
