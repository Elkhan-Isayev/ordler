import { isEmailDomainAllowed, isLocale, type Locale } from '@ordler/shared';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { constantTimeEqual, generateOtp, sha256 } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import { members, otpChallenges } from '../db/schema.js';
import type { Mailer } from '../mail/mailer.js';
import { renderOtpEmail } from '../mail/templates.js';
import { findMemberByEmail, nameFromEmail, registerMember } from '../members/members.js';
import { getInstance } from '../setup/setup.service.js';
import { DomainError } from './errors.js';
import type { Clock } from './sessions.js';
import type { StrategyService } from './strategies.js';

/** SPEC §8.1: 6 digits, valid 10 minutes, 5 attempts, 60 s between sends. */
export interface OtpPolicy {
  ttlMs: number;
  maxAttempts: number;
  resendCooldownMs: number;
}

export const DEFAULT_OTP_POLICY: OtpPolicy = {
  ttlMs: 10 * 60_000,
  maxAttempts: 5,
  resendCooldownMs: 60_000,
};

export class OtpService {
  constructor(
    private readonly db: Db,
    private readonly strategies: StrategyService,
    private readonly mailer: Mailer,
    private readonly policy: OtpPolicy = DEFAULT_OTP_POLICY,
    private readonly now: Clock = () => new Date(),
  ) {}

  /**
   * Sends a code when the email may sign in or self-register. The caller always gets the same
   * response, so the endpoint cannot be used to discover which emails have accounts.
   */
  async request(email: string): Promise<void> {
    const strategy = await this.strategies.requireUsable('email_otp');
    const member = await findMemberByEmail(this.db, email);
    const eligible = member
      ? member.status === 'active'
      : strategy.allowSelfRegistration && isEmailDomainAllowed(email, strategy.allowedDomains);
    if (!eligible) return;

    const now = this.now();
    const [latest] = await this.db
      .select({ createdAt: otpChallenges.createdAt })
      .from(otpChallenges)
      .where(eq(otpChallenges.email, email))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    // Silently skipped (not an error) so the cooldown does not reveal which emails are eligible.
    if (latest && now.getTime() - latest.createdAt.getTime() < this.policy.resendCooldownMs) {
      return;
    }

    const code = generateOtp();
    await this.db.transaction(async (tx) => {
      // A new code invalidates older ones, so only the latest email works.
      await tx
        .update(otpChallenges)
        .set({ consumedAt: now })
        .where(and(eq(otpChallenges.email, email), isNull(otpChallenges.consumedAt)));
      await tx.insert(otpChallenges).values({
        email,
        codeHash: sha256(code),
        expiresAt: new Date(now.getTime() + this.policy.ttlMs),
        createdAt: now,
      });
    });

    const instance = await getInstance(this.db);
    const locale: Locale =
      member?.locale && isLocale(member.locale) ? member.locale : (instance?.defaultLocale ?? 'en');
    const message = renderOtpEmail({
      locale,
      code,
      company: instance?.companyName ?? 'Ordler',
      minutes: Math.round(this.policy.ttlMs / 60_000),
    });
    await this.mailer.send({ to: email, ...message });
  }

  /** Returns the member id for a correct, unexpired, unused code (MVP acceptance criterion 8). */
  async verify(email: string, code: string): Promise<string> {
    const strategy = await this.strategies.requireUsable('email_otp');
    const now = this.now();
    const [challenge] = await this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.email, email),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (!challenge || challenge.attempts >= this.policy.maxAttempts) {
      throw new DomainError('invalid_code');
    }

    if (!constantTimeEqual(challenge.codeHash, sha256(code))) {
      await this.db
        .update(otpChallenges)
        .set({ attempts: sql`${otpChallenges.attempts} + 1` })
        .where(eq(otpChallenges.id, challenge.id));
      throw new DomainError('invalid_code');
    }

    // Conditional update makes the code single-use even under concurrent submissions.
    const consumed = await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (consumed.length === 0) throw new DomainError('invalid_code');

    const member = await findMemberByEmail(this.db, email);
    if (member) {
      if (member.status !== 'active') throw new DomainError('invalid_code');
      if (!member.emailVerifiedAt) {
        await this.db
          .update(members)
          .set({ emailVerifiedAt: now })
          .where(eq(members.id, member.id));
      }
      return member.id;
    }
    if (!strategy.allowSelfRegistration) throw new DomainError('registration_closed');
    if (!isEmailDomainAllowed(email, strategy.allowedDomains)) {
      throw new DomainError('domain_not_allowed');
    }
    const created = await registerMember(this.db, {
      email,
      name: nameFromEmail(email),
      emailVerified: true,
      strategy,
    });
    return created.id;
  }
}
