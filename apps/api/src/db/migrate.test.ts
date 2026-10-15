import { describe, expect, it } from 'vitest';
import {
  createSchemaSql,
  MIGRATION_LOCK_KEY,
  withAdvisoryLock,
  type LockClient,
} from './migrate.js';

function recordingClient(): LockClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push(`${sql} ${JSON.stringify(params ?? [])}`);
    },
  };
}

describe('withAdvisoryLock', () => {
  it('locks, runs and unlocks in order', async () => {
    const client = recordingClient();
    const result = await withAdvisoryLock(client, MIGRATION_LOCK_KEY, async () => {
      client.calls.push('migrate');
      return 'done';
    });
    expect(result).toBe('done');
    expect(client.calls).toEqual([
      `select pg_advisory_lock($1) [${MIGRATION_LOCK_KEY}]`,
      'migrate',
      `select pg_advisory_unlock($1) [${MIGRATION_LOCK_KEY}]`,
    ]);
  });

  it('releases the lock when the work fails', async () => {
    const client = recordingClient();
    await expect(
      withAdvisoryLock(client, 1, async () => {
        throw new Error('bad migration');
      }),
    ).rejects.toThrow('bad migration');
    expect(client.calls.at(-1)).toBe('select pg_advisory_unlock($1) [1]');
  });

  it('serialises concurrent callers', async () => {
    let held = false;
    const order: string[] = [];
    const waiters: Array<() => void> = [];
    const client: LockClient = {
      async query(sql) {
        if (sql.includes('pg_advisory_lock')) {
          while (held) await new Promise<void>((resolve) => waiters.push(resolve));
          held = true;
        } else {
          held = false;
          waiters.shift()?.();
        }
      },
    };
    const run = (name: string) =>
      withAdvisoryLock(client, 1, async () => {
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`${name}:end`);
      });
    await Promise.all([run('a'), run('b'), run('c')]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });
});

describe('createSchemaSql', () => {
  it('quotes the schema identifier', () => {
    expect(createSchemaSql('ordler')).toBe('create schema if not exists "ordler"');
    expect(createSchemaSql('a"b')).toBe('create schema if not exists "a""b"');
  });
});
