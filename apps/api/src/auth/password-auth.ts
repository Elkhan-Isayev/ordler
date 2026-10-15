import { eq } from 'drizzle-orm';
import {
  hashPassword,
  needsRehash,
  verifyPassword,
  type Argon2Params,
} from '../crypto/password.js';
import type { Db } from '../db/client.js';
import { memberPasswords } from '../db/schema.js';
import { findMemberByEmail } from '../members/members.js';
import { DomainError } from './errors.js';
import type { StrategyService } from './strategies.js';

export class PasswordAuthService {
  /** Verified against when the email is unknown, so response time does not reveal accounts. */
  private decoyHash: Promise<string>;

  constructor(
    private readonly db: Db,
    private readonly strategies: StrategyService,
    private readonly argon2?: Argon2Params,
  ) {
    this.decoyHash = hashPassword('ordler-decoy-password', argon2);
  }

  /** Returns the member id; every failure looks the same to the caller. */
  async signIn(email: string, password: string): Promise<string> {
    await this.strategies.requireUsable('local');
    const member = await findMemberByEmail(this.db, email);
    const [stored] = member
      ? await this.db.select().from(memberPasswords).where(eq(memberPasswords.memberId, member.id))
      : [];

    const valid = await verifyPassword(stored?.hash ?? (await this.decoyHash), password);
    if (!member || !stored || !valid || member.status !== 'active') {
      throw new DomainError('invalid_credentials');
    }

    if (needsRehash(stored.hash, this.argon2)) {
      await this.db
        .update(memberPasswords)
        .set({ hash: await hashPassword(password, this.argon2), updatedAt: new Date() })
        .where(eq(memberPasswords.memberId, member.id));
    }
    return member.id;
  }
}
