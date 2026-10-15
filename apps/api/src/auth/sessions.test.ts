import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { members, sessions } from '../db/schema.js';
import { completeSetup, testClock } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { RateLimiter } from './rate-limiter.js';
import { SessionService } from './sessions.js';

const DAY = 86_400_000;

let test: TestDatabase;
let db: Db;
let ownerId: string;
let clock: ReturnType<typeof testClock>;
let service: SessionService;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
  clock = testClock();
  service = new SessionService(db, 30 * DAY, clock.now);
});
afterEach(() => test.close());

describe('SessionService', () => {
  it('resolves a fresh session and stores only the token hash', async () => {
    const { token } = await service.create(ownerId, 'local', { ip: '10.0.0.1', userAgent: 'test' });
    expect(await service.resolve(token)).toMatchObject({
      memberId: ownerId,
      strategyKind: 'local',
    });
    const rows = await db.select().from(sessions);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('expires', async () => {
    const { token } = await service.create(ownerId, 'local');
    clock.advance(30 * DAY + 1);
    expect(await service.resolve(token)).toBeUndefined();
  });

  it('ends when the member is deactivated', async () => {
    const { token } = await service.create(ownerId, 'local');
    await db.update(members).set({ status: 'deactivated' }).where(eq(members.id, ownerId));
    expect(await service.resolve(token)).toBeUndefined();
  });

  it('rejects unknown and empty tokens', async () => {
    expect(await service.resolve('made-up-token')).toBeUndefined();
    expect(await service.resolve('')).toBeUndefined();
  });

  it('revokes one session or all of a member', async () => {
    const a = await service.create(ownerId, 'local');
    const b = await service.create(ownerId, 'google');
    await service.revoke(a.token);
    expect(await service.resolve(a.token)).toBeUndefined();
    expect(await service.resolve(b.token)).toBeDefined();
    await service.revokeAllForMember(ownerId);
    expect(await service.resolve(b.token)).toBeUndefined();
  });

  it('updates last-seen at most every five minutes', async () => {
    const { token } = await service.create(ownerId, 'local');
    clock.advance(60_000);
    await service.resolve(token);
    const [unchanged] = await db.select().from(sessions);
    expect(unchanged!.lastSeenAt.getTime()).toBe(clock.now().getTime() - 60_000);
    clock.advance(5 * 60_000);
    await service.resolve(token);
    const [touched] = await db.select().from(sessions);
    expect(touched!.lastSeenAt.getTime()).toBe(clock.now().getTime());
  });

  it('purges expired sessions', async () => {
    await service.create(ownerId, 'local');
    clock.advance(31 * DAY);
    await service.create(ownerId, 'local');
    expect(await service.purgeExpired()).toBe(1);
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit within the window, then blocks', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1_000, () => now);
    expect([1, 2, 3, 4].map(() => limiter.attempt('k'))).toEqual([true, true, true, false]);
    now = 1_001;
    expect(limiter.attempt('k')).toBe(true);
  });

  it('tracks keys separately and can reset', () => {
    const limiter = new RateLimiter(1, 1_000, () => 0);
    expect(limiter.attempt('a')).toBe(true);
    expect(limiter.attempt('b')).toBe(true);
    expect(limiter.attempt('a')).toBe(false);
    limiter.reset('a');
    expect(limiter.attempt('a')).toBe(true);
  });
});
