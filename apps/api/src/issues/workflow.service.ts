import {
  ISSUE_STATUS_CATEGORIES,
  type IssueStatusCategory,
  type WorkflowStatus,
} from '@ordler/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { issues, teams, workflows, workflowStatuses } from '../db/schema.js';
import type { EventBus } from '../realtime/event-bus.js';
import type { TeamAccess } from './team-access.js';
import { ensureTeamWorkflow, teamStatuses } from './workflows.js';

/** Categories every workflow keeps: triage declines and duplicates need a canceled status. */
const REQUIRED: readonly IssueStatusCategory[] = ['unstarted', 'completed', 'canceled'];

const order = (category: IssueStatusCategory) => ISSUE_STATUS_CATEGORIES.indexOf(category);

/**
 * Workflow editor (SPEC §5.2): team managers add, rename, reorder and archive statuses and
 * pick the default for new issues. Statuses stay grouped by category so boards read left to
 * right from backlog to done; archived statuses keep issue history readable.
 */
export class WorkflowService {
  constructor(
    private readonly db: Db,
    private readonly access: TeamAccess,
    private readonly events: EventBus,
  ) {}

  async add(
    memberId: string,
    teamKey: string,
    input: { name: string; category: IssueStatusCategory },
  ): Promise<WorkflowStatus[]> {
    const team = await this.managedTeam(memberId, teamKey);
    const workflowId = await ensureTeamWorkflow(this.db, team.id);
    const current = await teamStatuses(this.db, team.id);
    await this.db.insert(workflowStatuses).values({
      workflowId,
      name: input.name,
      category: input.category,
      position: current.length,
    });
    await this.normalize(team.id);
    return this.changed(memberId, team.id, 'workflow.status_added', { name: input.name });
  }

  async update(
    memberId: string,
    statusId: string,
    input: { name?: string; isDefault?: true },
  ): Promise<WorkflowStatus[]> {
    const { team, status } = await this.managedStatus(memberId, statusId);
    await this.db.transaction(async (tx) => {
      if (input.name !== undefined && input.name !== status.name) {
        // A renamed default status shows its new name instead of the translated default.
        await tx
          .update(workflowStatuses)
          .set({ name: input.name, key: null })
          .where(eq(workflowStatuses.id, status.id));
      }
      if (input.isDefault) {
        await tx
          .update(workflowStatuses)
          .set({ isDefault: sql`${workflowStatuses.id} = ${status.id}` })
          .where(eq(workflowStatuses.workflowId, status.workflowId));
      }
    });
    return this.changed(memberId, team.id, 'workflow.status_updated', { statusId, ...input });
  }

  /** New order inside each category; categories themselves keep their fixed order. */
  async reorder(memberId: string, teamKey: string, ids: string[]): Promise<WorkflowStatus[]> {
    const team = await this.managedTeam(memberId, teamKey);
    const current = await teamStatuses(this.db, team.id);
    if (ids.length !== current.length || current.some((s) => !ids.includes(s.id))) {
      throw new DomainError('validation_failed');
    }
    const byId = new Map(current.map((s) => [s.id, s]));
    const sorted = [...ids].sort(
      (a, b) =>
        order(byId.get(a)!.category) - order(byId.get(b)!.category) ||
        ids.indexOf(a) - ids.indexOf(b),
    );
    await this.db.transaction(async (tx) => {
      for (const [position, id] of sorted.entries()) {
        await tx.update(workflowStatuses).set({ position }).where(eq(workflowStatuses.id, id));
      }
    });
    return this.changed(memberId, team.id, 'workflow.reordered', { ids: sorted });
  }

  /** Only unused statuses go; the default and the last of a required category stay. */
  async archive(memberId: string, statusId: string): Promise<WorkflowStatus[]> {
    const { team, status } = await this.managedStatus(memberId, statusId);
    if (status.isDefault) throw new DomainError('status_required');
    const current = await teamStatuses(this.db, team.id);
    const sameCategory = current.filter((s) => s.category === status.category);
    if (REQUIRED.includes(status.category) && sameCategory.length === 1) {
      throw new DomainError('status_required');
    }
    const [used] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(eq(issues.statusId, status.id), isNull(issues.archivedAt)));
    if ((used?.count ?? 0) > 0) throw new DomainError('status_in_use');
    await this.db
      .update(workflowStatuses)
      .set({ archivedAt: new Date() })
      .where(eq(workflowStatuses.id, status.id));
    await this.normalize(team.id);
    return this.changed(memberId, team.id, 'workflow.status_archived', {
      statusId,
      name: status.name,
    });
  }

  /** Positions 0..n-1, grouped by category. */
  private async normalize(teamId: string): Promise<void> {
    const current = await teamStatuses(this.db, teamId);
    const sorted = [...current].sort(
      (a, b) => order(a.category) - order(b.category) || a.position - b.position,
    );
    for (const [position, status] of sorted.entries()) {
      if (status.position !== position) {
        await this.db
          .update(workflowStatuses)
          .set({ position })
          .where(eq(workflowStatuses.id, status.id));
      }
    }
  }

  private async changed(
    memberId: string,
    teamId: string,
    action: string,
    after: Record<string, unknown>,
  ): Promise<WorkflowStatus[]> {
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action,
      targetType: 'team',
      targetId: teamId,
      after,
    });
    // Open boards refetch the team: no issue changed, so the id is empty.
    await this.events.publish({ type: 'team.changed', teamId });
    return teamStatuses(this.db, teamId);
  }

  private async managedTeam(memberId: string, key: string) {
    const [team] = await this.db.select().from(teams).where(eq(teams.key, key.toUpperCase()));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    const can = await this.access.forTeam(memberId, team);
    if (!can.read) throw new DomainError('not_found');
    if (!can.manage) throw new DomainError('forbidden');
    return team;
  }

  private async managedStatus(memberId: string, statusId: string) {
    if (!/^[0-9a-f-]{36}$/.test(statusId)) throw new DomainError('not_found');
    const [row] = await this.db
      .select({ status: workflowStatuses, teamKey: teams.key })
      .from(workflowStatuses)
      .innerJoin(workflows, eq(workflows.id, workflowStatuses.workflowId))
      .innerJoin(teams, eq(teams.id, workflows.ownerId))
      .where(and(eq(workflowStatuses.id, statusId), isNull(workflowStatuses.archivedAt)));
    if (!row) throw new DomainError('not_found');
    const team = await this.managedTeam(memberId, row.teamKey);
    return { team, status: row.status };
  }
}
