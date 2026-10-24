import {
  can,
  type IssueStatusCategory,
  type MilestoneView,
  type ProjectDetail,
  type ProjectHealth,
  type ProjectInput,
  type ProjectProgress,
  type ProjectSummary,
} from '@ordler/shared';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import {
  issues,
  members,
  projectMembers,
  projectMilestones,
  projects,
  projectTeams,
  projectUpdates,
  teams,
  workflowStatuses,
} from '../db/schema.js';
import type { IssueService } from '../issues/issue.service.js';
import type { TeamAccess } from '../issues/team-access.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';

type ProjectRow = typeof projects.$inferSelect;
type ParsedInput = Required<Omit<ProjectInput, 'description'>> & { description: string };

const EMPTY: ProjectProgress = { total: 0, started: 0, completed: 0 };

/**
 * Projects (SPEC §5.2). A project spans teams; it is visible to anyone who can read one of
 * them, and its issues are always filtered by team visibility. Creating one needs
 * `project.manage` on every chosen team; its lead and `project.manage` holders edit it, and
 * its members may also post status updates.
 */
export class ProjectService {
  constructor(
    private readonly deps: {
      db: Db;
      access: AccessContextSource;
      teamAccess: TeamAccess;
      issues: IssueService;
      now?: () => Date;
    },
  ) {}

  private get db(): Db {
    return this.deps.db;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async list(memberId: string, teamKey?: string): Promise<ProjectSummary[]> {
    let ids: string[] | undefined;
    if (teamKey) {
      const team = await this.readableTeam(memberId, teamKey);
      ids = (
        await this.db
          .select({ id: projectTeams.projectId })
          .from(projectTeams)
          .where(eq(projectTeams.teamId, team.id))
      ).map((r) => r.id);
      if (ids.length === 0) return [];
    }
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(isNull(projects.archivedAt), ...(ids ? [inArray(projects.id, ids)] : [])))
      .orderBy(desc(projects.updatedAt));
    const visible: ProjectRow[] = [];
    for (const row of rows) if (await this.canSee(memberId, row.id)) visible.push(row);
    return this.summaries(visible);
  }

  async get(memberId: string, id: string): Promise<ProjectDetail> {
    const row = await this.visibleRow(memberId, id);
    const [summary] = await this.summaries([row]);
    const people = await this.db
      .select({ id: members.id, name: members.name })
      .from(projectMembers)
      .innerJoin(members, eq(members.id, projectMembers.memberId))
      .where(eq(projectMembers.projectId, id))
      .orderBy(asc(members.name));
    const updates = await this.db
      .select({ update: projectUpdates, name: members.name })
      .from(projectUpdates)
      .leftJoin(members, eq(members.id, projectUpdates.authorId))
      .where(eq(projectUpdates.projectId, id))
      .orderBy(desc(projectUpdates.createdAt));
    const milestones = await this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, id))
      .orderBy(asc(projectMilestones.position), asc(projectMilestones.createdAt));
    const issueList = await this.visibleIssues(memberId, id);
    const milestoneProgress = await this.progressBy(id, 'milestone');
    const edit = await this.canEdit(memberId, row);
    return {
      ...summary!,
      description: row.description,
      members: people,
      milestones: milestones.map((m): MilestoneView => ({
        id: m.id,
        name: m.name,
        targetDate: m.targetDate,
        progress: milestoneProgress.get(m.id) ?? EMPTY,
      })),
      updates: updates.map(({ update, name }) => ({
        id: update.id,
        author: update.authorId ? { id: update.authorId, name: name ?? '' } : null,
        health: update.health,
        body: update.body,
        createdAt: update.createdAt.toISOString(),
      })),
      issues: issueList,
      can: { edit, post: edit || people.some((p) => p.id === memberId) },
    };
  }

  async create(memberId: string, input: ParsedInput): Promise<ProjectDetail> {
    await this.assertCanManageTeams(memberId, input.teamIds);
    await this.assertMembers([input.leadId, ...input.memberIds]);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projects)
        .values({
          name: input.name,
          description: input.description,
          status: input.status,
          leadId: input.leadId,
          startDate: input.startDate,
          targetDate: input.targetDate,
          createdBy: memberId,
        })
        .returning({ id: projects.id });
      await tx
        .insert(projectTeams)
        .values(input.teamIds.map((teamId) => ({ projectId: row!.id, teamId })));
      if (input.memberIds.length > 0) {
        await tx
          .insert(projectMembers)
          .values(input.memberIds.map((m) => ({ projectId: row!.id, memberId: m })));
      }
      return row!.id;
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'project.created',
      targetType: 'project',
      targetId: id,
      after: { name: input.name, teamIds: input.teamIds },
    });
    return this.get(memberId, id);
  }

  async update(memberId: string, id: string, input: Partial<ParsedInput>): Promise<ProjectDetail> {
    const row = await this.visibleRow(memberId, id);
    if (!(await this.canEdit(memberId, row))) throw new DomainError('forbidden');
    if (input.teamIds) await this.assertCanManageTeams(memberId, input.teamIds);
    if (input.leadId !== undefined || input.memberIds) {
      await this.assertMembers([input.leadId ?? null, ...(input.memberIds ?? [])]);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
          ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
          ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
          updatedAt: this.now(),
        })
        .where(eq(projects.id, id));
      if (input.teamIds) {
        await tx.delete(projectTeams).where(eq(projectTeams.projectId, id));
        await tx
          .insert(projectTeams)
          .values(input.teamIds.map((teamId) => ({ projectId: id, teamId })));
        // Issues of teams that left the project leave it too.
        await tx
          .update(issues)
          .set({ projectId: null, milestoneId: null })
          .where(and(eq(issues.projectId, id), notInArray(issues.teamId, input.teamIds)));
      }
      if (input.memberIds) {
        await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
        if (input.memberIds.length > 0) {
          await tx
            .insert(projectMembers)
            .values(input.memberIds.map((m) => ({ projectId: id, memberId: m })));
        }
      }
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'project.updated',
      targetType: 'project',
      targetId: id,
      after: Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'description')),
    });
    return this.get(memberId, id);
  }

  /** Projects are archived, never erased; their issues simply leave them. */
  async archive(memberId: string, id: string): Promise<void> {
    const row = await this.visibleRow(memberId, id);
    if (!(await this.canEdit(memberId, row))) throw new DomainError('forbidden');
    await this.db.transaction(async (tx) => {
      await tx.update(projects).set({ archivedAt: this.now() }).where(eq(projects.id, id));
      await tx
        .update(issues)
        .set({ projectId: null, milestoneId: null })
        .where(eq(issues.projectId, id));
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'project.archived',
      targetType: 'project',
      targetId: id,
    });
  }

  async postUpdate(
    memberId: string,
    id: string,
    input: { health: ProjectHealth; body: string },
  ): Promise<ProjectDetail> {
    const detail = await this.get(memberId, id);
    if (!detail.can.post) throw new DomainError('forbidden');
    await this.db.insert(projectUpdates).values({ projectId: id, authorId: memberId, ...input });
    await this.db.update(projects).set({ updatedAt: this.now() }).where(eq(projects.id, id));
    return this.get(memberId, id);
  }

  async addMilestone(
    memberId: string,
    id: string,
    input: { name: string; targetDate: string | null },
  ): Promise<ProjectDetail> {
    await this.editable(memberId, id);
    const [last] = await this.db
      .select({ max: sql<number | null>`max(${projectMilestones.position})` })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, id));
    await this.db
      .insert(projectMilestones)
      .values({ projectId: id, ...input, position: (last?.max ?? 0) + 1 });
    return this.get(memberId, id);
  }

  async updateMilestone(
    memberId: string,
    milestoneId: string,
    input: { name: string; targetDate: string | null },
  ): Promise<ProjectDetail> {
    const milestone = await this.milestone(milestoneId);
    await this.editable(memberId, milestone.projectId);
    await this.db.update(projectMilestones).set(input).where(eq(projectMilestones.id, milestoneId));
    return this.get(memberId, milestone.projectId);
  }

  async removeMilestone(memberId: string, milestoneId: string): Promise<ProjectDetail> {
    const milestone = await this.milestone(milestoneId);
    await this.editable(memberId, milestone.projectId);
    await this.db.transaction(async (tx) => {
      await tx.update(issues).set({ milestoneId: null }).where(eq(issues.milestoneId, milestoneId));
      await tx.delete(projectMilestones).where(eq(projectMilestones.id, milestoneId));
    });
    return this.get(memberId, milestone.projectId);
  }

  // -------------------------------------------------------------------------------------------

  private async summaries(rows: ProjectRow[]): Promise<ProjectSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const teamRows = await this.db
      .select({ projectId: projectTeams.projectId, id: teams.id, key: teams.key, name: teams.name })
      .from(projectTeams)
      .innerJoin(teams, eq(teams.id, projectTeams.teamId))
      .where(inArray(projectTeams.projectId, ids))
      .orderBy(asc(teams.key));
    const leadIds = rows.flatMap((r) => (r.leadId ? [r.leadId] : []));
    const leads =
      leadIds.length === 0
        ? []
        : await this.db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(inArray(members.id, leadIds));
    const latest = await this.db
      .selectDistinctOn([projectUpdates.projectId], {
        projectId: projectUpdates.projectId,
        health: projectUpdates.health,
      })
      .from(projectUpdates)
      .where(inArray(projectUpdates.projectId, ids))
      .orderBy(projectUpdates.projectId, desc(projectUpdates.createdAt));
    const progress = await this.progressBy(ids, 'project');
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      lead: leads.find((l) => l.id === row.leadId) ?? null,
      teams: teamRows
        .filter((t) => t.projectId === row.id)
        .map(({ id, key, name }) => ({ id, key, name })),
      startDate: row.startDate,
      targetDate: row.targetDate,
      progress: progress.get(row.id) ?? EMPTY,
      health: latest.find((h) => h.projectId === row.id)?.health ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** Issue counts by status category, per project or per milestone. */
  private async progressBy(
    scope: string | string[],
    by: 'project' | 'milestone',
  ): Promise<Map<string, ProjectProgress>> {
    const ids = Array.isArray(scope) ? scope : [scope];
    const key = by === 'project' ? issues.projectId : issues.milestoneId;
    const rows = await this.db
      .select({ key, category: workflowStatuses.category, count: sql<number>`count(*)::int` })
      .from(issues)
      .innerJoin(workflowStatuses, eq(workflowStatuses.id, issues.statusId))
      .where(and(inArray(issues.projectId, ids), isNull(issues.archivedAt)))
      .groupBy(key, workflowStatuses.category);
    const map = new Map<string, ProjectProgress>();
    for (const row of rows) {
      if (!row.key) continue;
      const current = map.get(row.key) ?? { ...EMPTY };
      const category = row.category as IssueStatusCategory;
      if (category !== 'canceled') current.total += row.count;
      if (category === 'started') current.started += row.count;
      if (category === 'completed') current.completed += row.count;
      map.set(row.key, current);
    }
    return map;
  }

  private async visibleIssues(memberId: string, projectId: string) {
    const teamRows = await this.db
      .select({ team: teams })
      .from(projectTeams)
      .innerJoin(teams, eq(teams.id, projectTeams.teamId))
      .where(eq(projectTeams.projectId, projectId));
    const result = [];
    for (const { team } of teamRows) {
      if (team.archivedAt || !(await this.deps.teamAccess.forTeam(memberId, team)).read) continue;
      const list = await this.deps.issues.list(memberId, team.key);
      result.push(...list.filter((issue) => issue.projectId === projectId));
    }
    return result;
  }

  private async canSee(memberId: string, projectId: string): Promise<boolean> {
    const teamRows = await this.db
      .select({ team: teams })
      .from(projectTeams)
      .innerJoin(teams, eq(teams.id, projectTeams.teamId))
      .where(eq(projectTeams.projectId, projectId));
    for (const { team } of teamRows) {
      if ((await this.deps.teamAccess.forTeam(memberId, team)).read) return true;
    }
    return false;
  }

  private async canEdit(memberId: string, row: ProjectRow): Promise<boolean> {
    if (row.leadId === memberId) return true;
    const loaded = await this.deps.access.load(memberId);
    const teamIds = (
      await this.db
        .select({ id: projectTeams.teamId })
        .from(projectTeams)
        .where(eq(projectTeams.projectId, row.id))
    ).map((r) => r.id);
    return teamIds.some((id) =>
      can(
        loaded.assignments,
        loaded.rolePermissions,
        'project.manage',
        { type: 'team', id },
        loaded.directory,
      ),
    );
  }

  private async editable(memberId: string, id: string): Promise<void> {
    const row = await this.visibleRow(memberId, id);
    if (!(await this.canEdit(memberId, row))) throw new DomainError('forbidden');
  }

  private async assertCanManageTeams(memberId: string, teamIds: string[]): Promise<void> {
    const loaded = await this.deps.access.load(memberId);
    const rows = await this.db.select().from(teams).where(inArray(teams.id, teamIds));
    if (rows.length !== teamIds.length || rows.some((t) => t.archivedAt)) {
      throw new DomainError('not_found');
    }
    for (const team of rows) {
      if (!(await this.deps.teamAccess.forTeam(memberId, team)).read)
        throw new DomainError('not_found');
      const allowed = can(
        loaded.assignments,
        loaded.rolePermissions,
        'project.manage',
        { type: 'team', id: team.id },
        loaded.directory,
      );
      if (!allowed) throw new DomainError('forbidden');
    }
  }

  private async assertMembers(ids: Array<string | null>): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return;
    const found = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(inArray(members.id, wanted), eq(members.status, 'active')));
    if (found.length !== wanted.length) throw new DomainError('not_found');
  }

  private async visibleRow(memberId: string, id: string): Promise<ProjectRow> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    if (!row || row.archivedAt || !(await this.canSee(memberId, id)))
      throw new DomainError('not_found');
    return row;
  }

  private async milestone(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async readableTeam(memberId: string, key: string) {
    const [team] = await this.db.select().from(teams).where(eq(teams.key, key.toUpperCase()));
    if (!team || team.archivedAt || !(await this.deps.teamAccess.forTeam(memberId, team)).read) {
      throw new DomainError('not_found');
    }
    return team;
  }
}
