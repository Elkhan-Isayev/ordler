import {
  viewInputSchema,
  type SavedView,
  type ViewFilters,
  type ViewInput,
  type ViewUpdate,
} from '@ordler/shared';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { members, savedViews, teams } from '../db/schema.js';
import type { TeamAccess, TeamPermissions } from '../issues/team-access.js';

type TeamRow = typeof teams.$inferSelect;
type ViewRow = typeof savedViews.$inferSelect;

/**
 * Saved views (SPEC §5.4): a personal view is seen and changed only by its owner; a shared one
 * by everyone who reads the team, and changed only by members with `view.create_shared`.
 */
export class ViewService {
  constructor(
    private readonly db: Db,
    private readonly access: TeamAccess,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Views of one team the member can see: their own and the shared ones. */
  async listTeam(memberId: string, key: string): Promise<SavedView[]> {
    const { team, can } = await this.readableTeam(memberId, key);
    return this.views(memberId, [{ team, can }]);
  }

  /** Views across every team the member can read (the workspace Views page). */
  async listAll(memberId: string): Promise<SavedView[]> {
    const rows = await this.db.select().from(teams).where(isNull(teams.archivedAt));
    const readable: Array<{ team: TeamRow; can: TeamPermissions }> = [];
    for (const team of rows) {
      const can = await this.access.forTeam(memberId, team);
      if (can.read) readable.push({ team, can });
    }
    return this.views(memberId, readable);
  }

  async create(memberId: string, key: string, raw: ViewInput): Promise<SavedView> {
    const { team, can } = await this.readableTeam(memberId, key);
    const input = viewInputSchema.parse(raw);
    if (input.shared && !can.shareViews) throw new DomainError('forbidden');
    const [row] = await this.db
      .insert(savedViews)
      .values({
        teamId: team.id,
        ownerId: memberId,
        name: input.name,
        layout: input.layout,
        filters: input.filters,
        shared: input.shared,
      })
      .returning();
    if (row!.shared) await this.audit(memberId, 'view.created', row!);
    return this.get(memberId, row!.id);
  }

  async get(memberId: string, id: string): Promise<SavedView> {
    const { row, team, can } = await this.visible(memberId, id);
    const [view] = await this.views(memberId, [{ team, can }], [row.id]);
    if (!view) throw new DomainError('not_found');
    return view;
  }

  async update(memberId: string, id: string, input: ViewUpdate): Promise<SavedView> {
    const { row, can } = await this.editable(memberId, id);
    // Publishing a personal view to the team needs the same right as creating a shared one.
    if (input.shared === true && !row.shared && !can.shareViews) throw new DomainError('forbidden');
    await this.db
      .update(savedViews)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.layout !== undefined ? { layout: input.layout } : {}),
        ...(input.filters !== undefined ? { filters: input.filters } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
        updatedAt: this.now(),
      })
      .where(eq(savedViews.id, id));
    if (row.shared || input.shared) await this.audit(memberId, 'view.updated', row, input);
    return this.get(memberId, id);
  }

  async remove(memberId: string, id: string): Promise<void> {
    const { row } = await this.editable(memberId, id);
    await this.db.delete(savedViews).where(eq(savedViews.id, id));
    if (row.shared) await this.audit(memberId, 'view.deleted', row);
  }

  private async views(
    memberId: string,
    readable: Array<{ team: TeamRow; can: TeamPermissions }>,
    ids?: string[],
  ): Promise<SavedView[]> {
    if (readable.length === 0) return [];
    const byTeam = new Map(readable.map((entry) => [entry.team.id, entry]));
    const rows = await this.db
      .select({ view: savedViews, ownerName: members.name })
      .from(savedViews)
      .leftJoin(members, eq(members.id, savedViews.ownerId))
      .where(
        and(
          inArray(savedViews.teamId, [...byTeam.keys()]),
          or(eq(savedViews.shared, true), eq(savedViews.ownerId, memberId)),
          ...(ids ? [inArray(savedViews.id, ids)] : []),
        ),
      )
      .orderBy(asc(savedViews.name), asc(savedViews.createdAt));
    return rows.map(({ view, ownerName }) => {
      const { team, can } = byTeam.get(view.teamId)!;
      return {
        id: view.id,
        name: view.name,
        layout: view.layout,
        filters: view.filters as ViewFilters,
        shared: view.shared,
        team: { id: team.id, key: team.key, name: team.name },
        owner: view.ownerId ? { id: view.ownerId, name: ownerName ?? '' } : null,
        canEdit: canEdit(memberId, view, can),
        createdAt: view.createdAt.toISOString(),
        updatedAt: view.updatedAt.toISOString(),
      };
    });
  }

  private async visible(memberId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(savedViews).where(eq(savedViews.id, id));
    if (!row) throw new DomainError('not_found');
    const [team] = await this.db.select().from(teams).where(eq(teams.id, row.teamId));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    const can = await this.access.forTeam(memberId, team);
    // Someone else's personal view looks exactly like a missing one.
    if (!can.read || (!row.shared && row.ownerId !== memberId)) {
      throw new DomainError('not_found');
    }
    return { row, team, can };
  }

  private async editable(memberId: string, id: string) {
    const found = await this.visible(memberId, id);
    if (!canEdit(memberId, found.row, found.can)) throw new DomainError('forbidden');
    return found;
  }

  private async readableTeam(memberId: string, key: string) {
    const [team] = await this.db.select().from(teams).where(eq(teams.key, key.toUpperCase()));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    const can = await this.access.forTeam(memberId, team);
    if (!can.read) throw new DomainError('not_found');
    return { team, can };
  }

  private audit(memberId: string, action: string, row: ViewRow, after?: ViewUpdate) {
    return writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action,
      targetType: 'view',
      targetId: row.id,
      before: { name: row.name, layout: row.layout, filters: row.filters, shared: row.shared },
      ...(after ? { after } : {}),
    });
  }
}

function canEdit(memberId: string, view: ViewRow, can: TeamPermissions): boolean {
  return view.shared ? can.shareViews : view.ownerId === memberId;
}
