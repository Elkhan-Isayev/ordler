import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog, authStrategies, memberIdentities } from '../db/schema.js';
import { systemRoleId } from '../setup/system-roles.js';
import { completeSetup, strategiesFor, testBox } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { StrategyService } from './strategies.js';

let test: TestDatabase;
let db: Db;
let ownerId: string;
const actor = () => ({ type: 'member' as const, id: ownerId });

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
});
afterEach(() => test.close());

describe('StrategyService', () => {
  it('starts with only local sign-in enabled', async () => {
    const strategies = await strategiesFor(db);
    expect((await strategies.list()).map((s) => [s.kind, s.enabled])).toEqual([
      ['local', true],
      ['email_otp', false],
      ['google', false],
    ]);
    expect((await strategies.usable()).map((s) => s.kind)).toEqual(['local']);
  });

  it('hides email OTP while mail is not configured', async () => {
    const strategies = await strategiesFor(db, { mail: false });
    await expect(
      strategies.update('email_otp', { enabled: true }, actor(), 'local'),
    ).rejects.toMatchObject({ code: 'mail_not_configured' });
  });

  it('enables email OTP when mail is configured', async () => {
    const strategies = await strategiesFor(db);
    await strategies.update('email_otp', { enabled: true }, actor(), 'local');
    expect((await strategies.usable()).map((s) => s.kind)).toEqual(['local', 'email_otp']);
  });

  it('refuses to enable Google without client credentials', async () => {
    const strategies = await strategiesFor(db);
    await expect(
      strategies.update('google', { enabled: true }, actor(), 'local'),
    ).rejects.toMatchObject({ code: 'strategy_disabled' });
  });

  it('stores the Google client secret encrypted and never returns it', async () => {
    const box = testBox();
    const strategies = await strategiesFor(db, { box });
    const updated = await strategies.update(
      'google',
      {
        enabled: true,
        config: { clientId: 'client-id.apps.googleusercontent.com' },
        secrets: { clientSecret: 'super-secret-value' },
        allowSelfRegistration: true,
        allowedDomains: ['company.com'],
      },
      actor(),
      'local',
    );
    expect(updated.hasClientSecret).toBe(true);
    expect(JSON.stringify(await strategies.list())).not.toContain('super-secret-value');

    const [row] = await db.select().from(authStrategies).where(eq(authStrategies.kind, 'google'));
    expect(row!.secretsEncrypted).not.toContain('super-secret-value');
    expect(await strategies.clientSecret('google')).toBe('super-secret-value');

    // A different key cannot read it (e.g. after ENCRYPTION_KEY is rotated without migration).
    expect(
      await new StrategyService(db, testBox(), { isConfigured: async () => true }).clientSecret(
        'google',
      ),
    ).toBeUndefined();

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'auth_strategy.updated'));
    expect(JSON.stringify(audit)).not.toContain('super-secret-value');
  });

  it('keeps the stored secret when other fields change', async () => {
    const strategies = await strategiesFor(db);
    await strategies.update(
      'google',
      { config: { clientId: 'id' }, secrets: { clientSecret: 'kept-secret' } },
      actor(),
      'local',
    );
    await strategies.update('google', { allowedDomains: ['a.com'] }, actor(), 'local');
    expect(await strategies.clientSecret('google')).toBe('kept-secret');
  });

  it('prevents disabling the last usable strategy', async () => {
    const strategies = await strategiesFor(db);
    await expect(
      strategies.update('local', { enabled: false }, actor(), 'local'),
    ).rejects.toMatchObject({ code: 'lockout_prevented' });
  });

  it('prevents disabling the strategy the admin is signed in with when nothing else works for them', async () => {
    const strategies = await strategiesFor(db);
    await strategies.update(
      'google',
      { enabled: true, config: { clientId: 'id' }, secrets: { clientSecret: 's' } },
      actor(),
      'local',
    );
    await expect(
      strategies.update('local', { enabled: false }, actor(), 'local'),
    ).rejects.toMatchObject({ code: 'lockout_prevented' });

    await db
      .insert(memberIdentities)
      .values({ memberId: ownerId, strategyKind: 'google', providerSubject: 'sub-1' });
    const updated = await strategies.update('local', { enabled: false }, actor(), 'local');
    expect(updated.enabled).toBe(false);
  });

  it('allows disabling local when email OTP stays available', async () => {
    const strategies = await strategiesFor(db);
    await strategies.update('email_otp', { enabled: true }, actor(), 'local');
    expect((await strategies.update('local', { enabled: false }, actor(), 'local')).enabled).toBe(
      false,
    );
  });

  it('validates the default role', async () => {
    const strategies = await strategiesFor(db);
    await expect(
      strategies.update(
        'local',
        { defaultRoleId: '01a13d37-d040-7000-b257-95d0695e0576' },
        actor(),
        'local',
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const guest = await systemRoleId(db, 'guest');
    expect(
      (await strategies.update('local', { defaultRoleId: guest! }, actor(), 'local')).defaultRoleId,
    ).toBe(guest);
  });
});
