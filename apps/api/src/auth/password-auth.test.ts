import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../crypto/password.js';
import type { Db } from '../db/client.js';
import { memberPasswords, members } from '../db/schema.js';
import { completeSetup, FAST_ARGON2, OWNER, strategiesFor } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { PasswordAuthService } from './password-auth.js';

let test: TestDatabase;
let db: Db;
let ownerId: string;
let auth: PasswordAuthService;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
  auth = new PasswordAuthService(db, await strategiesFor(db), FAST_ARGON2);
});
afterEach(() => test.close());

describe('PasswordAuthService', () => {
  it('signs in with the right password, case-insensitive email', async () => {
    expect(await auth.signIn('OWNER@push30.test', OWNER.password)).toBe(ownerId);
  });

  it('rejects a wrong password', async () => {
    await expect(auth.signIn(OWNER.email, 'wrong-password-1')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('gives unknown emails the same answer', async () => {
    await expect(auth.signIn('nobody@push30.test', OWNER.password)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('rejects deactivated members even with the right password', async () => {
    await db.update(members).set({ status: 'deactivated' }).where(eq(members.id, ownerId));
    await expect(auth.signIn(OWNER.email, OWNER.password)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('refuses when local sign-in is disabled', async () => {
    const strategies = await strategiesFor(db);
    await strategies.update(
      'email_otp',
      { enabled: true },
      { type: 'member', id: ownerId },
      'local',
    );
    await strategies.update('local', { enabled: false }, { type: 'member', id: ownerId }, 'local');
    await expect(auth.signIn(OWNER.email, OWNER.password)).rejects.toMatchObject({
      code: 'strategy_disabled',
    });
  });

  it('upgrades hashes made with weaker parameters', async () => {
    const weak = await hashPassword(OWNER.password, { memory: 512, passes: 1, parallelism: 1 });
    await db
      .update(memberPasswords)
      .set({ hash: weak })
      .where(eq(memberPasswords.memberId, ownerId));
    await auth.signIn(OWNER.email, OWNER.password);
    const [row] = await db
      .select()
      .from(memberPasswords)
      .where(eq(memberPasswords.memberId, ownerId));
    expect(row!.hash).toContain('m=1024');
  });
});
