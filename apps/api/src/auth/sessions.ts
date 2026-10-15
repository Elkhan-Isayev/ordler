import type { AuthStrategyKind } from '@ordler/shared';
import { and, eq, gt, lt } from 'drizzle-orm';
import { randomToken, sha256 } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import { members, sessions } from '../db/schema.js';

export const SESSION_COOKIE = 'ordler_session';

/** Avoids a write on every request; last-seen only needs minute-level accuracy. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ResolvedSession {
  sessionId: string;
  memberId: string;
  strategyKind: AuthStrategyKind;
}

export type Clock = () => Date;

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly ttlMs: number,
    private readonly now: Clock = () => new Date(),
  ) {}

  async create(
    memberId: string,
    strategyKind: AuthStrategyKind,
    meta: SessionMeta = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs);
    await this.db.insert(sessions).values({
      memberId,
      tokenHash: sha256(token),
      strategyKind,
      expiresAt,
      lastSeenAt: this.now(),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    });
    return { token, expiresAt };
  }

  /** Valid only while unexpired and the member is still active. */
  async resolve(token: string): Promise<ResolvedSession | undefined> {
    if (!token) return undefined;
    const now = this.now();
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        memberId: sessions.memberId,
        strategyKind: sessions.strategyKind,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .innerJoin(members, eq(members.id, sessions.memberId))
      .where(
        and(
          eq(sessions.tokenHash, sha256(token)),
          gt(sessions.expiresAt, now),
          eq(members.status, 'active'),
        ),
      );
    if (!row) return undefined;

    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
    }
    return {
      sessionId: row.sessionId,
      memberId: row.memberId,
      strategyKind: row.strategyKind as AuthStrategyKind,
    };
  }

  async revoke(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }

  async revokeAllForMember(memberId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.memberId, memberId));
  }

  async purgeExpired(): Promise<number> {
    const removed = await this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, this.now()))
      .returning({ id: sessions.id });
    return removed.length;
  }
}
