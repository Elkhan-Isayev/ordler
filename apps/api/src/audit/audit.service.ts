import type { AuditEntryView, AuditPage, AuditQuery } from '@ordler/shared';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog, members } from '../db/schema.js';

/** Admin → Audit log (SPEC §9): read-only, newest first, keyset-paginated by uuidv7 id. */
export class AuditService {
  constructor(private readonly db: Db) {}

  async list(query: AuditQuery & { limit: number }): Promise<AuditPage> {
    const filters: SQL[] = [];
    if (query.action) filters.push(eq(auditLog.action, query.action));
    if (query.targetType) filters.push(eq(auditLog.targetType, query.targetType));
    if (query.actorId) filters.push(eq(auditLog.actorId, query.actorId));
    if (query.before) filters.push(lt(auditLog.id, query.before));
    const rows = await this.db
      .select({ entry: auditLog, actorName: members.name })
      .from(auditLog)
      .leftJoin(members, eq(members.id, auditLog.actorId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const entries: AuditEntryView[] = page.map(({ entry, actorName }) => ({
      id: entry.id,
      actor: { type: entry.actorType, id: entry.actorId, name: actorName },
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip,
      createdAt: entry.createdAt.toISOString(),
    }));
    return { entries, next: rows.length > query.limit ? page.at(-1)!.entry.id : null };
  }
}
