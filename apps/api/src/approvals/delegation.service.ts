import type { DelegationInput, DelegationView } from '@ordler/shared';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { approvalDelegations, members } from '../db/schema.js';

/** Calendar date in UTC; delegation ranges are whole days. */
const today = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Out-of-office delegation (SPEC §6.3): a member names someone who decides their approvals
 * between two dates. Approvers stay who they were; the decision records both people.
 */
export class DelegationService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(memberId: string): Promise<DelegationView[]> {
    const rows = await this.db
      .select({ delegation: approvalDelegations, name: members.name })
      .from(approvalDelegations)
      .innerJoin(members, eq(members.id, approvalDelegations.delegateId))
      .where(
        and(
          eq(approvalDelegations.memberId, memberId),
          isNull(approvalDelegations.revokedAt),
          gte(approvalDelegations.endsOn, today(this.now())),
        ),
      )
      .orderBy(asc(approvalDelegations.startsOn));
    const date = today(this.now());
    return rows.map(({ delegation, name }) => ({
      id: delegation.id,
      delegate: { id: delegation.delegateId, name },
      startsOn: delegation.startsOn,
      endsOn: delegation.endsOn,
      active: delegation.startsOn <= date && date <= delegation.endsOn,
    }));
  }

  async create(memberId: string, input: DelegationInput): Promise<DelegationView[]> {
    if (input.delegateId === memberId) throw new DomainError('validation_failed');
    if (input.endsOn < today(this.now())) throw new DomainError('validation_failed');
    const [delegate] = await this.db
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, input.delegateId));
    if (!delegate || delegate.status !== 'active') throw new DomainError('validation_failed');
    // One stand-in per day keeps "who decides for me" unambiguous.
    const [overlap] = await this.db
      .select({ id: approvalDelegations.id })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.memberId, memberId),
          isNull(approvalDelegations.revokedAt),
          lte(approvalDelegations.startsOn, input.endsOn),
          gte(approvalDelegations.endsOn, input.startsOn),
        ),
      );
    if (overlap) throw new DomainError('delegation_overlap');
    const [row] = await this.db
      .insert(approvalDelegations)
      .values({ memberId, ...input })
      .returning({ id: approvalDelegations.id });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'delegation.created',
      targetType: 'approval_delegation',
      targetId: row!.id,
      after: input,
    });
    return this.list(memberId);
  }

  async revoke(memberId: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const changed = await this.db
      .update(approvalDelegations)
      .set({ revokedAt: this.now() })
      .where(
        and(
          eq(approvalDelegations.id, id),
          eq(approvalDelegations.memberId, memberId),
          isNull(approvalDelegations.revokedAt),
        ),
      )
      .returning({ id: approvalDelegations.id });
    if (changed.length === 0) throw new DomainError('not_found');
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'delegation.revoked',
      targetType: 'approval_delegation',
      targetId: id,
    });
  }

  /** Members whose approvals `delegateId` may decide today. */
  async delegatorsOf(delegateId: string): Promise<string[]> {
    const date = today(this.now());
    const rows = await this.db
      .select({ memberId: approvalDelegations.memberId })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.delegateId, delegateId),
          isNull(approvalDelegations.revokedAt),
          lte(approvalDelegations.startsOn, date),
          gte(approvalDelegations.endsOn, date),
        ),
      );
    return [...new Set(rows.map((r) => r.memberId))];
  }

  /** Today's stand-ins of these approvers, for notifications. */
  async delegatesOf(memberIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (memberIds.length === 0) return result;
    const date = today(this.now());
    const rows = await this.db
      .select({
        memberId: approvalDelegations.memberId,
        delegateId: approvalDelegations.delegateId,
      })
      .from(approvalDelegations)
      .where(
        and(
          inArray(approvalDelegations.memberId, memberIds),
          isNull(approvalDelegations.revokedAt),
          lte(approvalDelegations.startsOn, date),
          gte(approvalDelegations.endsOn, date),
        ),
      );
    for (const row of rows) result.set(row.memberId, row.delegateId);
    return result;
  }
}
