import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { members, roleAssignments } from '../db/schema.js';
import { MemoryMailer } from '../mail/mailer.js';
import { systemRoleId } from '../setup/system-roles.js';
import { completeSetup, OWNER, strategiesFor, testClock } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { DEFAULT_OTP_POLICY, OtpService } from './otp.js';
import type { StrategyService } from './strategies.js';

let test: TestDatabase;
let db: Db;
let ownerId: string;
let mailer: MemoryMailer;
let clock: ReturnType<typeof testClock>;
let strategies: StrategyService;
let otp: OtpService;

const actor = () => ({ type: 'member' as const, id: ownerId });
const lastCode = () => /(\d{6})/.exec(mailer.sent.at(-1)!.subject)![1]!;

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
  mailer = new MemoryMailer();
  clock = testClock();
  strategies = await strategiesFor(db);
  await strategies.update('email_otp', { enabled: true }, actor(), 'local');
  otp = new OtpService(db, strategies, mailer, DEFAULT_OTP_POLICY, clock.now);
});
afterEach(() => test.close());

describe('OtpService.request', () => {
  it('emails a code to an existing member', async () => {
    await otp.request(OWNER.email);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(OWNER.email);
    expect(mailer.sent[0]!.text).toContain('Push30');
  });

  it('writes in the member language', async () => {
    await db.update(members).set({ locale: 'de' }).where(eq(members.id, ownerId));
    await otp.request(OWNER.email);
    expect(mailer.sent[0]!.subject).toContain('Anmeldecode');
  });

  it('stays silent for unknown emails when self-registration is closed', async () => {
    await otp.request('stranger@push30.test');
    expect(mailer.sent).toHaveLength(0);
  });

  it('does not resend within the cooldown', async () => {
    await otp.request(OWNER.email);
    clock.advance(30_000);
    await otp.request(OWNER.email);
    expect(mailer.sent).toHaveLength(1);
    clock.advance(31_000);
    await otp.request(OWNER.email);
    expect(mailer.sent).toHaveLength(2);
  });

  it('fails when the strategy is disabled', async () => {
    await strategies.update('email_otp', { enabled: false }, actor(), 'local');
    await expect(otp.request(OWNER.email)).rejects.toMatchObject({ code: 'strategy_disabled' });
  });
});

describe('OtpService.verify', () => {
  it('signs in with the emailed code', async () => {
    await otp.request(OWNER.email);
    expect(await otp.verify(OWNER.email, lastCode())).toBe(ownerId);
  });

  it('is single-use', async () => {
    await otp.request(OWNER.email);
    const code = lastCode();
    await otp.verify(OWNER.email, code);
    await expect(otp.verify(OWNER.email, code)).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it('rejects an expired code (MVP acceptance criterion 8)', async () => {
    await otp.request(OWNER.email);
    clock.advance(10 * 60_000 + 1);
    await expect(otp.verify(OWNER.email, lastCode())).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });

  it('locks the code after five wrong attempts (MVP acceptance criterion 8)', async () => {
    await otp.request(OWNER.email);
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await expect(otp.verify(OWNER.email, wrong)).rejects.toMatchObject({ code: 'invalid_code' });
    }
    await expect(otp.verify(OWNER.email, code)).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it('invalidates the previous code when a new one is sent', async () => {
    await otp.request(OWNER.email);
    const first = lastCode();
    clock.advance(61_000);
    await otp.request(OWNER.email);
    const second = lastCode();
    if (first !== second) {
      await expect(otp.verify(OWNER.email, first)).rejects.toMatchObject({ code: 'invalid_code' });
    }
    expect(await otp.verify(OWNER.email, second)).toBe(ownerId);
  });

  it('rejects deactivated members', async () => {
    await otp.request(OWNER.email);
    await db.update(members).set({ status: 'deactivated' }).where(eq(members.id, ownerId));
    await expect(otp.verify(OWNER.email, lastCode())).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });
});

describe('self-registration via email OTP', () => {
  beforeEach(async () => {
    const guest = await systemRoleId(db, 'guest');
    await strategies.update(
      'email_otp',
      { allowSelfRegistration: true, allowedDomains: ['company.com'], defaultRoleId: guest! },
      actor(),
      'local',
    );
  });

  it('creates a verified member with the default role', async () => {
    await otp.request('new.person@company.com');
    const memberId = await otp.verify('new.person@company.com', lastCode());
    const [member] = await db.select().from(members).where(eq(members.id, memberId));
    expect(member).toMatchObject({ email: 'new.person@company.com', name: 'new.person' });
    expect(member!.emailVerifiedAt).not.toBeNull();
    const grants = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.memberId, memberId));
    expect(grants).toEqual([
      expect.objectContaining({
        roleId: await systemRoleId(db, 'guest'),
        scopeType: 'organization',
      }),
    ]);
  });

  it('sends nothing to domains outside the allow-list', async () => {
    await otp.request('someone@gmail.com');
    expect(mailer.sent).toHaveLength(0);
  });
});
