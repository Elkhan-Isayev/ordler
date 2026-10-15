import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export interface AuditActor {
  type: 'member' | 'token' | 'system';
  id?: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export const SYSTEM_ACTOR: AuditActor = { type: 'system' };

const SECRET_KEY = /(secret|password|token|hash|key)/i;

/** Secrets never reach the audit log (SPEC §8.1); their presence is recorded instead. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SECRET_KEY.test(key) ? (inner == null ? inner : '[redacted]') : redactSecrets(inner),
      ]),
    );
  }
  return value;
}

/** Append-only by design: there is no update or delete counterpart. */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorType: entry.actor.type,
    actorId: entry.actor.id ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    before: entry.before === undefined ? null : redactSecrets(entry.before),
    after: entry.after === undefined ? null : redactSecrets(entry.after),
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
