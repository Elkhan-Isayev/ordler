import type { AuthStrategyKind } from '@ordler/shared';
import { eq, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import type { AuthStrategy } from '../auth/strategies.js';
import type { Db } from '../db/client.js';
import { members, roleAssignments } from '../db/schema.js';

export type MemberRow = typeof members.$inferSelect;

export async function findMemberByEmail(db: Db, email: string): Promise<MemberRow | undefined> {
  const [row] = await db
    .select()
    .from(members)
    .where(eq(sql`lower(${members.email})`, email.toLowerCase()));
  return row;
}

export async function findMemberById(db: Db, id: string): Promise<MemberRow | undefined> {
  const [row] = await db.select().from(members).where(eq(members.id, id));
  return row;
}

/** Display name for self-registered members until they set one: the email's local part. */
export function nameFromEmail(email: string): string {
  return email.slice(0, email.indexOf('@')) || email;
}

/**
 * Creates an active member through self-registration and grants the strategy's default role
 * at organization scope (SPEC §8.1).
 */
export async function registerMember(
  db: Db,
  input: { email: string; name: string; emailVerified: boolean; strategy: AuthStrategy },
): Promise<MemberRow> {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .insert(members)
      .values({
        email: input.email.toLowerCase(),
        name: input.name,
        status: 'active',
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      })
      .returning();
    if (input.strategy.defaultRoleId) {
      await tx.insert(roleAssignments).values({
        memberId: member!.id,
        roleId: input.strategy.defaultRoleId,
        scopeType: 'organization',
        scopeId: null,
      });
    }
    await writeAudit(tx as unknown as Db, {
      actor: { type: 'member', id: member!.id },
      action: 'member.self_registered',
      targetType: 'member',
      targetId: member!.id,
      after: {
        email: member!.email,
        strategy: input.strategy.kind satisfies AuthStrategyKind,
        defaultRoleId: input.strategy.defaultRoleId,
      },
    });
    return member!;
  });
}
