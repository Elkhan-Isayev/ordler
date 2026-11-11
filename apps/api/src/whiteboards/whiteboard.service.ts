import {
  WHITEBOARD_MAX_ELEMENT_BYTES,
  WHITEBOARD_MAX_ELEMENTS,
  whiteboardCreateSchema,
  whiteboardFileSchema,
  whiteboardSceneUpdateSchema,
  type MemberRef,
  type WhiteboardCreate,
  type WhiteboardElement,
  type WhiteboardFile,
  type WhiteboardFileInput,
  type WhiteboardScene,
  type WhiteboardSummary,
  type WhiteboardView,
} from '@ordler/shared';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import {
  issues,
  issueWhiteboards,
  members,
  teams,
  whiteboardElements,
  whiteboardFiles,
  whiteboards,
} from '../db/schema.js';
import type { IssueService } from '../issues/issue.service.js';
import type { TeamAccess, TeamPermissions } from '../issues/team-access.js';
import type { EventBus } from '../realtime/event-bus.js';

type BoardRow = typeof whiteboards.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATA_URL = /^data:([a-z+/.-]+);base64,([A-Za-z0-9+/]*={0,2})$/;
const MAX_FILES_PER_READ = 50;

export interface WhiteboardServiceDeps {
  db: Db;
  access: TeamAccess;
  issues: Pick<IssueService, 'access'>;
  events: EventBus;
  /** Upload limit per image, the same as for attachments (ATTACHMENT_MAX_MB). */
  maxFileBytes: number;
  now?: () => Date;
}

/** What a save did: the change number it got and which elements won over the stored ones. */
export interface SceneSaveResult {
  seq: number;
  accepted: string[];
}

/**
 * Whiteboards (SPEC §5.5, ADR 0015). Reading needs read access to the team; drawing needs
 * `whiteboard.edit` there. Concurrent edits converge per element: the higher version wins and
 * ties go to the lower nonce, exactly as the editor reconciles them in the browser.
 */
export class WhiteboardService {
  constructor(private readonly deps: WhiteboardServiceDeps) {}

  private get db(): Db {
    return this.deps.db;
  }

  /** Boards of every team the member can read, or of one team; newest change first. */
  async list(memberId: string, teamKey?: string): Promise<WhiteboardSummary[]> {
    const teamRows = teamKey
      ? await this.db.select().from(teams).where(eq(teams.key, teamKey.toUpperCase()))
      : await this.db.select().from(teams).where(isNull(teams.archivedAt));
    const readable = new Map<string, { team: TeamRow; can: TeamPermissions }>();
    for (const team of teamRows) {
      if (team.archivedAt) continue;
      const can = await this.deps.access.forTeam(memberId, team);
      if (can.read) readable.set(team.id, { team, can });
    }
    if (teamKey && readable.size === 0) throw new DomainError('not_found');
    if (readable.size === 0) return [];
    const rows = await this.db
      .select({ board: whiteboards, creatorName: members.name })
      .from(whiteboards)
      .leftJoin(members, eq(members.id, whiteboards.createdBy))
      .where(and(inArray(whiteboards.teamId, [...readable.keys()]), isNull(whiteboards.archivedAt)))
      .orderBy(desc(whiteboards.updatedAt));
    return rows.map(({ board, creatorName }) => {
      const { team, can } = readable.get(board.teamId)!;
      return summary(memberId, board, team, can, creatorName);
    });
  }

  async create(memberId: string, raw: WhiteboardCreate, via?: string): Promise<WhiteboardView> {
    const input = whiteboardCreateSchema.parse(raw);
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.key, input.team.toUpperCase()));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    const can = await this.deps.access.forTeam(memberId, team);
    if (!can.read) throw new DomainError('not_found');
    if (!can.whiteboards) throw new DomainError('forbidden');
    // Checked before anything is written, so a refused link leaves no orphan board behind.
    const issue = input.issue ? await this.linkableIssue(memberId, input.issue) : undefined;
    const [row] = await this.db
      .insert(whiteboards)
      .values({ teamId: team.id, title: input.title, createdBy: memberId })
      .returning();
    await this.audit(memberId, 'whiteboard.created', row!, { title: row!.title }, via);
    if (issue) await this.insertLink(memberId, issue, row!, via);
    return this.get(memberId, row!.id);
  }

  async get(memberId: string, id: string): Promise<WhiteboardView> {
    const { row, team, can } = await this.readable(memberId, id);
    const [creator] = row.createdBy
      ? await this.db
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, row.createdBy))
      : [];
    return {
      ...summary(memberId, row, team, can, creator?.name ?? null),
      issues: await this.linkedIssues(memberId, row.id),
    };
  }

  async rename(memberId: string, id: string, title: string): Promise<WhiteboardView> {
    const { row, team } = await this.manageable(memberId, id);
    await this.db
      .update(whiteboards)
      .set({ title, updatedAt: this.now() })
      .where(eq(whiteboards.id, row.id));
    await this.audit(memberId, 'whiteboard.renamed', row, { title });
    await this.deps.events.publish({
      type: 'whiteboard.changed',
      teamId: team.id,
      whiteboardId: id,
    });
    return this.get(memberId, id);
  }

  /** Deleting archives: the content stays in the database, attached issues stop listing it. */
  async archive(memberId: string, id: string): Promise<void> {
    const { row, team } = await this.manageable(memberId, id);
    await this.db
      .update(whiteboards)
      .set({ archivedAt: this.now() })
      .where(eq(whiteboards.id, row.id));
    await this.audit(memberId, 'whiteboard.deleted', row, undefined);
    await this.deps.events.publish({
      type: 'whiteboard.changed',
      teamId: team.id,
      whiteboardId: id,
    });
  }

  /**
   * Elements changed after `since`. A full load (`since` 0) skips deleted elements; catching up
   * includes them, because other tabs must learn about the deletion.
   */
  async scene(memberId: string, id: string, since = 0): Promise<WhiteboardScene> {
    const { row } = await this.readable(memberId, id);
    return this.sceneOf(row.id, row.seq, since);
  }

  /** Every element, deleted ones skipped; for MCP and diagram building. */
  async elements(memberId: string, id: string): Promise<WhiteboardElement[]> {
    const { row } = await this.readable(memberId, id);
    return (await this.sceneOf(row.id, row.seq, 0)).elements;
  }

  /** Saves elements an editor changed; stored newer versions win, see the class comment. */
  async save(memberId: string, id: string, raw: unknown, via?: string): Promise<SceneSaveResult> {
    const parsed = whiteboardSceneUpdateSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError('validation_failed');
    const { row, team, can } = await this.readable(memberId, id);
    if (!can.whiteboards) throw new DomainError('forbidden');

    const batch = new Map<string, WhiteboardElement>();
    for (const element of parsed.data.elements) {
      if (JSON.stringify(element).length > WHITEBOARD_MAX_ELEMENT_BYTES) {
        throw new DomainError('validation_failed');
      }
      // One statement cannot touch a row twice: keep the winner when an id repeats.
      const seen = batch.get(element.id);
      if (!seen || wins(element, seen)) batch.set(element.id, element);
    }
    const elements = [...batch.values()];
    await this.assertRoom(row, elements);

    const now = this.now();
    const result = await this.db.transaction(async (tx) => {
      // The row lock orders saves: change numbers commit in sequence, readers never skip one.
      const [locked] = await tx
        .update(whiteboards)
        .set({ seq: sql`${whiteboards.seq} + 1`, updatedAt: now })
        .where(and(eq(whiteboards.id, row.id), isNull(whiteboards.archivedAt)))
        .returning({ seq: whiteboards.seq });
      if (!locked) throw new DomainError('not_found');
      const written = await tx
        .insert(whiteboardElements)
        .values(
          elements.map((element) => ({
            whiteboardId: row.id,
            elementId: element.id,
            version: element.version,
            versionNonce: element.versionNonce,
            isDeleted: element.isDeleted,
            seq: locked.seq,
            data: element,
            updatedBy: memberId,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [whiteboardElements.whiteboardId, whiteboardElements.elementId],
          set: {
            version: sql`excluded.version`,
            versionNonce: sql`excluded.version_nonce`,
            isDeleted: sql`excluded.is_deleted`,
            seq: sql`excluded.seq`,
            data: sql`excluded.data`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`excluded.version > ${whiteboardElements.version} or (excluded.version = ${whiteboardElements.version} and excluded.version_nonce < ${whiteboardElements.versionNonce})`,
        })
        .returning({
          elementId: whiteboardElements.elementId,
          // xmax is 0 only for freshly inserted rows: they count against the board's limit.
          inserted: sql<boolean>`(xmax = 0)`,
        });
      const added = written.filter((w) => w.inserted).length;
      if (added > 0) {
        await tx
          .update(whiteboards)
          .set({ elementCount: sql`${whiteboards.elementCount} + ${added}` })
          .where(eq(whiteboards.id, row.id));
      }
      return { seq: locked.seq, accepted: written.map((w) => w.elementId) };
    });

    if (result.accepted.length > 0) {
      await this.deps.events.publish({
        type: 'whiteboard.elements',
        teamId: team.id,
        whiteboardId: row.id,
        seq: result.seq,
      });
      // Editors save many times a second; only agents' changes are audited (SPEC §10.1).
      if (via !== undefined) {
        await this.audit(
          memberId,
          'whiteboard.content_changed',
          row,
          {
            elements: result.accepted.length,
          },
          via,
        );
      }
    }
    return result;
  }

  /** Elements saved under one change number; realtime fans them out to open tabs. */
  async changesAt(id: string, seq: number): Promise<WhiteboardElement[]> {
    const rows = await this.db
      .select({ data: whiteboardElements.data })
      .from(whiteboardElements)
      .where(and(eq(whiteboardElements.whiteboardId, id), eq(whiteboardElements.seq, seq)));
    return rows.map((r) => r.data as WhiteboardElement);
  }

  /** The team a board belongs to, for realtime access checks; undefined when gone. */
  async teamOf(id: string): Promise<string | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await this.db
      .select({ teamId: whiteboards.teamId })
      .from(whiteboards)
      .where(and(eq(whiteboards.id, id), isNull(whiteboards.archivedAt)));
    return row?.teamId;
  }

  async memberRef(memberId: string): Promise<MemberRef> {
    const [row] = await this.db
      .select({ name: members.name })
      .from(members)
      .where(eq(members.id, memberId));
    return { id: memberId, name: row?.name ?? '' };
  }

  /** Stores an image placed on the board; ids are content-derived, so a repeat is a no-op. */
  async saveFile(memberId: string, id: string, raw: WhiteboardFileInput): Promise<void> {
    const parsed = whiteboardFileSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError('validation_failed');
    const { row, can } = await this.readable(memberId, id);
    if (!can.whiteboards) throw new DomainError('forbidden');
    const match = DATA_URL.exec(parsed.data.dataURL);
    if (!match || match[1] !== parsed.data.mimeType) throw new DomainError('validation_failed');
    const data = Buffer.from(match[2]!, 'base64');
    if (data.length === 0) throw new DomainError('file_missing');
    if (data.length > this.deps.maxFileBytes) throw new DomainError('file_too_large');
    await this.db
      .insert(whiteboardFiles)
      .values({
        whiteboardId: row.id,
        fileId: parsed.data.id,
        mimeType: parsed.data.mimeType,
        size: data.length,
        data,
        createdBy: memberId,
      })
      .onConflictDoNothing();
  }

  async files(memberId: string, id: string, ids: string[]): Promise<WhiteboardFile[]> {
    const { row } = await this.readable(memberId, id);
    const wanted = [...new Set(ids)].filter((f) => /^[A-Za-z0-9_-]{1,128}$/.test(f));
    if (wanted.length === 0) return [];
    const rows = await this.db
      .select()
      .from(whiteboardFiles)
      .where(
        and(
          eq(whiteboardFiles.whiteboardId, row.id),
          inArray(whiteboardFiles.fileId, wanted.slice(0, MAX_FILES_PER_READ)),
        ),
      );
    return rows.map((file) => ({
      id: file.fileId,
      mimeType: file.mimeType,
      dataURL: `data:${file.mimeType};base64,${file.data.toString('base64')}`,
      created: file.createdAt.getTime(),
    }));
  }

  /** Boards attached to an issue that the member can read. */
  async forIssue(memberId: string, identifier: string): Promise<WhiteboardSummary[]> {
    const issue = await this.deps.issues.access(memberId, identifier);
    const rows = await this.db
      .select({ board: whiteboards, team: teams, creatorName: members.name })
      .from(issueWhiteboards)
      .innerJoin(whiteboards, eq(whiteboards.id, issueWhiteboards.whiteboardId))
      .innerJoin(teams, eq(teams.id, whiteboards.teamId))
      .leftJoin(members, eq(members.id, whiteboards.createdBy))
      .where(and(eq(issueWhiteboards.issueId, issue.issueId), isNull(whiteboards.archivedAt)))
      .orderBy(asc(issueWhiteboards.createdAt));
    const result: WhiteboardSummary[] = [];
    for (const { board, team, creatorName } of rows) {
      const can = await this.deps.access.forTeam(memberId, team);
      // A board of a team the member cannot read stays hidden, even on an issue they can.
      if (can.read && !team.archivedAt)
        result.push(summary(memberId, board, team, can, creatorName));
    }
    return result;
  }

  async link(memberId: string, identifier: string, whiteboardId: string, via?: string) {
    const issue = await this.linkableIssue(memberId, identifier);
    const { row } = await this.readable(memberId, whiteboardId);
    await this.insertLink(memberId, issue, row, via);
    return this.forIssue(memberId, identifier);
  }

  async unlink(memberId: string, identifier: string, whiteboardId: string): Promise<void> {
    const issue = await this.linkableIssue(memberId, identifier);
    if (!UUID.test(whiteboardId)) throw new DomainError('not_found');
    const removed = await this.db
      .delete(issueWhiteboards)
      .where(
        and(
          eq(issueWhiteboards.issueId, issue.issueId),
          eq(issueWhiteboards.whiteboardId, whiteboardId),
        ),
      )
      .returning({ id: issueWhiteboards.whiteboardId });
    if (removed.length === 0) throw new DomainError('not_found');
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'whiteboard.unlinked',
      targetType: 'whiteboard',
      targetId: whiteboardId,
      before: { issue: issue.identifier },
    });
  }

  private async insertLink(
    memberId: string,
    issue: { issueId: string; identifier: string },
    board: BoardRow,
    via?: string,
  ): Promise<void> {
    const inserted = await this.db
      .insert(issueWhiteboards)
      .values({ issueId: issue.issueId, whiteboardId: board.id, createdBy: memberId })
      .onConflictDoNothing()
      .returning({ id: issueWhiteboards.whiteboardId });
    if (inserted.length > 0) {
      await this.audit(memberId, 'whiteboard.linked', board, { issue: issue.identifier }, via);
    }
  }

  /** Attaching a board changes the issue, so it needs `issue.update` in the issue's team. */
  private async linkableIssue(memberId: string, identifier: string) {
    const issue = await this.deps.issues.access(memberId, identifier);
    if (!issue.can.update) throw new DomainError('forbidden');
    return issue;
  }

  private async linkedIssues(memberId: string, boardId: string) {
    const rows = await this.db
      .select({ teamKey: teams.key, number: issues.number, title: issues.title })
      .from(issueWhiteboards)
      .innerJoin(issues, eq(issues.id, issueWhiteboards.issueId))
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .where(and(eq(issueWhiteboards.whiteboardId, boardId), isNull(issues.archivedAt)))
      .orderBy(asc(issueWhiteboards.createdAt));
    const result: Array<{ identifier: string; title: string }> = [];
    for (const row of rows) {
      try {
        const issue = await this.deps.issues.access(memberId, `${row.teamKey}-${row.number}`);
        result.push({ identifier: issue.identifier, title: issue.title });
      } catch (error) {
        // Issues of teams the member cannot read are left out, not reported.
        if (!(error instanceof DomainError)) throw error;
      }
    }
    return result;
  }

  private async sceneOf(boardId: string, seq: number, since: number): Promise<WhiteboardScene> {
    // `seq` was read before the elements: rows newer than it may show up twice, never zero times.
    const rows = await this.db
      .select({ data: whiteboardElements.data })
      .from(whiteboardElements)
      .where(
        and(
          eq(whiteboardElements.whiteboardId, boardId),
          since > 0 ? gt(whiteboardElements.seq, since) : eq(whiteboardElements.isDeleted, false),
        ),
      );
    return { seq, elements: rows.map((r) => r.data as WhiteboardElement) };
  }

  /** Refuses saves that would push the board over its element limit. */
  private async assertRoom(row: BoardRow, elements: WhiteboardElement[]): Promise<void> {
    if (row.elementCount + elements.length <= WHITEBOARD_MAX_ELEMENTS) return;
    const existing = await this.db
      .select({ id: whiteboardElements.elementId })
      .from(whiteboardElements)
      .where(
        and(
          eq(whiteboardElements.whiteboardId, row.id),
          inArray(
            whiteboardElements.elementId,
            elements.map((e) => e.id),
          ),
        ),
      );
    const added = elements.length - existing.length;
    if (row.elementCount + added > WHITEBOARD_MAX_ELEMENTS)
      throw new DomainError('whiteboard_full');
  }

  private async readable(memberId: string, id: string) {
    if (!UUID.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(whiteboards).where(eq(whiteboards.id, id));
    if (!row || row.archivedAt) throw new DomainError('not_found');
    const [team] = await this.db.select().from(teams).where(eq(teams.id, row.teamId));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    const can = await this.deps.access.forTeam(memberId, team);
    // Boards of unreadable (e.g. private) teams look exactly like missing ones.
    if (!can.read) throw new DomainError('not_found');
    return { row, team, can };
  }

  private async manageable(memberId: string, id: string) {
    const found = await this.readable(memberId, id);
    if (!canManage(memberId, found.row, found.can)) throw new DomainError('forbidden');
    return found;
  }

  private audit(
    memberId: string,
    action: string,
    row: BoardRow,
    after: Record<string, unknown> | undefined,
    via?: string,
  ) {
    return writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action,
      targetType: 'whiteboard',
      targetId: row.id,
      before: { title: row.title, teamId: row.teamId },
      ...(after || via !== undefined
        ? { after: { ...after, ...(via === undefined ? {} : { via }) } }
        : {}),
    });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** The editor's rule: higher version wins, equal versions go to the lower nonce. */
export function wins(candidate: WhiteboardElement, current: WhiteboardElement): boolean {
  return (
    candidate.version > current.version ||
    (candidate.version === current.version && candidate.versionNonce < current.versionNonce)
  );
}

function canManage(memberId: string, row: BoardRow, can: TeamPermissions): boolean {
  return can.manage || (can.whiteboards && row.createdBy === memberId);
}

function summary(
  memberId: string,
  board: BoardRow,
  team: TeamRow,
  can: TeamPermissions,
  creatorName: string | null,
): WhiteboardSummary {
  return {
    id: board.id,
    title: board.title,
    team: { id: team.id, key: team.key, name: team.name },
    createdBy: board.createdBy ? { id: board.createdBy, name: creatorName ?? '' } : null,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    canEdit: can.whiteboards,
    canManage: canManage(memberId, board, can),
  };
}
