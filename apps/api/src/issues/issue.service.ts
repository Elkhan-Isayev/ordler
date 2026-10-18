import {
  formatIssueIdentifier,
  parseIssueIdentifier,
  type CommentView,
  type CreateIssueInput,
  type IssueDetail,
  type IssueEvent,
  type IssueField,
  type IssueSummary,
  type TeamView,
  type UpdateIssueInput,
} from '@ordler/shared';
import { aliasedTable, and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import {
  comments,
  departments,
  issueEvents,
  issues,
  members,
  teamMemberships,
  teams,
  workflowStatuses,
} from '../db/schema.js';
import type { EventBus } from '../realtime/event-bus.js';
import type { TeamAccess, TeamPermissions } from './team-access.js';
import { teamStatuses } from './workflows.js';

type TeamRow = typeof teams.$inferSelect;

const assignee = aliasedTable(members, 'assignee');

const TRACKED: IssueField[] = [
  'title',
  'description',
  'statusId',
  'priority',
  'assigneeId',
  'dueDate',
];

export interface IssueServiceDeps {
  db: Db;
  access: TeamAccess;
  events: EventBus;
  now?: () => Date;
}

/**
 * Issues inside a team (SPEC §5.1): create, read, update, history. Every call checks the
 * caller's team permissions; teams the caller cannot see answer `not_found`.
 */
export class IssueService {
  constructor(private readonly deps: IssueServiceDeps) {}

  private get db(): Db {
    return this.deps.db;
  }

  async team(memberId: string, key: string): Promise<TeamView> {
    const { team, can } = await this.readableTeam(memberId, key);
    const [department] = await this.db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.id, team.departmentId));
    const people = await this.db
      .select({ id: members.id, name: members.name })
      .from(teamMemberships)
      .innerJoin(members, eq(members.id, teamMemberships.memberId))
      .where(and(eq(teamMemberships.teamId, team.id), eq(members.status, 'active')))
      .orderBy(asc(members.name));
    return {
      id: team.id,
      key: team.key,
      name: team.name,
      isPrivate: team.isPrivate,
      department: department!,
      statuses: await teamStatuses(this.db, team.id),
      members: people,
      can: { create: can.create, update: can.update, assign: can.assign, comment: can.comment },
    };
  }

  async list(memberId: string, key: string): Promise<IssueSummary[]> {
    const { team } = await this.readableTeam(memberId, key);
    return this.summaries(and(eq(issues.teamId, team.id), isNull(issues.archivedAt)));
  }

  /** My issues: assigned to me, across every team I can still read. */
  async assignedTo(memberId: string): Promise<IssueSummary[]> {
    const all = await this.summaries(
      and(eq(issues.assigneeId, memberId), isNull(issues.archivedAt), isNull(teams.archivedAt)),
    );
    const allowed = new Map<string, boolean>();
    const result: IssueSummary[] = [];
    for (const issue of all) {
      if (!allowed.has(issue.teamId)) {
        const [team] = await this.db.select().from(teams).where(eq(teams.id, issue.teamId));
        allowed.set(issue.teamId, (await this.deps.access.forTeam(memberId, team!)).read);
      }
      if (allowed.get(issue.teamId)) result.push(issue);
    }
    return result;
  }

  async create(memberId: string, key: string, input: CreateIssueInput): Promise<IssueDetail> {
    const { team, can } = await this.readableTeam(memberId, key);
    if (!can.create) throw new DomainError('forbidden');
    if (input.assigneeId && !can.assign) throw new DomainError('forbidden');

    const statuses = await teamStatuses(this.db, team.id);
    const statusId = input.statusId ?? (statuses.find((s) => s.isDefault) ?? statuses[0])!.id;
    if (!statuses.some((s) => s.id === statusId)) throw new DomainError('status_not_in_workflow');
    if (input.assigneeId) await this.assertTeamMember(team.id, input.assigneeId);

    const now = this.now();
    const issueId = await this.db.transaction(async (tx) => {
      // The row lock on the team serialises numbering: identifiers never repeat or skip.
      const [counter] = await tx
        .update(teams)
        .set({ issueCounter: sql`${teams.issueCounter} + 1` })
        .where(eq(teams.id, team.id))
        .returning({ number: teams.issueCounter });
      const [top] = await tx
        .select({ min: sql<number | null>`min(${issues.sortOrder})` })
        .from(issues)
        .where(and(eq(issues.teamId, team.id), eq(issues.statusId, statusId)));
      const [row] = await tx
        .insert(issues)
        .values({
          teamId: team.id,
          number: counter!.number,
          title: input.title,
          description: input.description,
          statusId,
          priority: input.priority,
          assigneeId: input.assigneeId,
          dueDate: input.dueDate,
          // New issues go to the top of their column.
          sortOrder: (top?.min ?? 1) - 1,
          createdBy: memberId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: issues.id });
      await tx.insert(issueEvents).values({
        issueId: row!.id,
        actorId: memberId,
        kind: 'created',
        changes: {},
        createdAt: now,
      });
      return row!.id;
    });

    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    return this.detailById(issueId, memberId);
  }

  async get(memberId: string, identifier: string): Promise<IssueDetail> {
    const { issueId } = await this.readableIssue(memberId, identifier);
    return this.detailById(issueId, memberId);
  }

  async update(
    memberId: string,
    identifier: string,
    input: UpdateIssueInput,
  ): Promise<IssueDetail> {
    const { issueId, team, can } = await this.readableIssue(memberId, identifier);
    const touchesAssignee = input.assigneeId !== undefined;
    const touchesOther = Object.keys(input).some((field) => field !== 'assigneeId');
    if (touchesAssignee && !can.assign) throw new DomainError('forbidden');
    if (touchesOther && !can.update) throw new DomainError('forbidden');

    if (input.statusId !== undefined) {
      const statuses = await teamStatuses(this.db, team.id);
      if (!statuses.some((s) => s.id === input.statusId)) {
        throw new DomainError('status_not_in_workflow');
      }
    }
    if (input.assigneeId) await this.assertTeamMember(team.id, input.assigneeId);

    const [before] = await this.db.select().from(issues).where(eq(issues.id, issueId));
    const changes: IssueEvent['changes'] = {};
    for (const field of TRACKED) {
      const next = input[field];
      if (next === undefined || next === before![field]) continue;
      // Descriptions can be long; history records that it changed, not both versions.
      changes[field] =
        field === 'description' ? { from: null, to: null } : { from: before![field], to: next };
    }

    const now = this.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set({ ...input, updatedAt: now })
        .where(eq(issues.id, issueId));
      if (Object.keys(changes).length > 0) {
        await tx
          .insert(issueEvents)
          .values({ issueId, actorId: memberId, kind: 'updated', changes, createdAt: now });
      }
    });

    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    return this.detailById(issueId, memberId);
  }

  /** The issue as a team subscriber sees it; used to fan out realtime updates. */
  async summary(issueId: string): Promise<IssueSummary | undefined> {
    const [row] = await this.summaries(eq(issues.id, issueId));
    return row;
  }

  /** Permissions for an already-known team (realtime subscriptions). */
  async permissionsForTeamId(memberId: string, teamId: string): Promise<TeamPermissions> {
    const [team] = await this.db.select().from(teams).where(eq(teams.id, teamId));
    if (!team || team.archivedAt)
      return {
        read: false,
        create: false,
        update: false,
        assign: false,
        comment: false,
        deleteAnyComment: false,
      };
    return this.deps.access.forTeam(memberId, team);
  }

  private async readableTeam(
    memberId: string,
    key: string,
  ): Promise<{ team: TeamRow; can: TeamPermissions }> {
    const [team] = await this.db.select().from(teams).where(eq(teams.key, key.toUpperCase()));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    const can = await this.deps.access.forTeam(memberId, team);
    // Unreadable teams look exactly like missing ones, so private team keys do not leak.
    if (!can.read) throw new DomainError('not_found');
    return { team, can };
  }

  private async readableIssue(memberId: string, identifier: string) {
    const parsed = parseIssueIdentifier(identifier.toUpperCase());
    if (!parsed) throw new DomainError('not_found');
    const { team, can } = await this.readableTeam(memberId, parsed.teamKey);
    const [row] = await this.db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.teamId, team.id),
          eq(issues.number, parsed.number),
          isNull(issues.archivedAt),
        ),
      );
    if (!row) throw new DomainError('not_found');
    return { issueId: row.id, team, can };
  }

  private async assertTeamMember(teamId: string, memberId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: members.id })
      .from(teamMemberships)
      .innerJoin(members, eq(members.id, teamMemberships.memberId))
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.memberId, memberId),
          eq(members.status, 'active'),
        ),
      );
    if (!row) throw new DomainError('assignee_not_in_team');
  }

  private async summaries(where: ReturnType<typeof and>): Promise<IssueSummary[]> {
    const rows = await this.db
      .select({
        issue: issues,
        teamKey: teams.key,
        assigneeName: assignee.name,
        status: {
          id: workflowStatuses.id,
          key: workflowStatuses.key,
          name: workflowStatuses.name,
          category: workflowStatuses.category,
        },
      })
      .from(issues)
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .innerJoin(workflowStatuses, eq(workflowStatuses.id, issues.statusId))
      .leftJoin(assignee, eq(assignee.id, issues.assigneeId))
      .where(where)
      .orderBy(asc(issues.sortOrder), desc(issues.number));
    return rows.map(({ issue, teamKey, assigneeName, status }) => ({
      id: issue.id,
      identifier: formatIssueIdentifier(teamKey, issue.number),
      teamId: issue.teamId,
      teamKey,
      number: issue.number,
      title: issue.title,
      statusId: issue.statusId,
      status,
      priority: issue.priority,
      assignee: issue.assigneeId ? { id: issue.assigneeId, name: assigneeName ?? '' } : null,
      dueDate: issue.dueDate,
      sortOrder: issue.sortOrder,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    }));
  }

  async addComment(memberId: string, identifier: string, body: string): Promise<IssueDetail> {
    const { issueId, team, can } = await this.readableIssue(memberId, identifier);
    if (!can.comment) throw new DomainError('forbidden');
    const now = this.now();
    await this.db.transaction(async (tx) => {
      await tx.insert(comments).values({
        subjectType: 'issue',
        subjectId: issueId,
        authorId: memberId,
        body,
        createdAt: now,
        updatedAt: now,
      });
      // Comments count as activity: boards sort and refresh by updatedAt.
      await tx.update(issues).set({ updatedAt: now }).where(eq(issues.id, issueId));
    });
    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    return this.detailById(issueId, memberId);
  }

  async editComment(memberId: string, commentId: string, body: string): Promise<IssueDetail> {
    const { comment, issueId, team } = await this.readableComment(memberId, commentId);
    // Only the author may change their words; nobody can rewrite someone else's comment.
    if (comment.authorId !== memberId || comment.deletedAt) throw new DomainError('forbidden');
    const now = this.now();
    await this.db.update(comments).set({ body, updatedAt: now }).where(eq(comments.id, commentId));
    await this.db.update(issues).set({ updatedAt: now }).where(eq(issues.id, issueId));
    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    return this.detailById(issueId, memberId);
  }

  async deleteComment(memberId: string, commentId: string): Promise<IssueDetail> {
    const { comment, issueId, team, can } = await this.readableComment(memberId, commentId);
    if (comment.authorId !== memberId && !can.deleteAnyComment) throw new DomainError('forbidden');
    if (!comment.deletedAt) {
      const now = this.now();
      await this.db.update(comments).set({ deletedAt: now }).where(eq(comments.id, commentId));
      await this.db.update(issues).set({ updatedAt: now }).where(eq(issues.id, issueId));
      await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    }
    return this.detailById(issueId, memberId);
  }

  private async readableComment(memberId: string, commentId: string) {
    if (!/^[0-9a-f-]{36}$/.test(commentId)) throw new DomainError('not_found');
    const [row] = await this.db
      .select({ comment: comments, team: teams })
      .from(comments)
      .innerJoin(issues, eq(issues.id, comments.subjectId))
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .where(and(eq(comments.id, commentId), eq(comments.subjectType, 'issue')));
    if (!row || row.team.archivedAt) throw new DomainError('not_found');
    const can = await this.deps.access.forTeam(memberId, row.team);
    if (!can.read) throw new DomainError('not_found');
    return { comment: row.comment, issueId: row.comment.subjectId, team: row.team, can };
  }

  private async detailById(issueId: string, viewerId: string): Promise<IssueDetail> {
    const summary = (await this.summary(issueId))!;
    const [row] = await this.db
      .select({
        description: issues.description,
        createdBy: issues.createdBy,
        creatorName: members.name,
      })
      .from(issues)
      .leftJoin(members, eq(members.id, issues.createdBy))
      .where(eq(issues.id, issueId));
    const events = await this.db
      .select({ event: issueEvents, actorName: members.name })
      .from(issueEvents)
      .leftJoin(members, eq(members.id, issueEvents.actorId))
      .where(eq(issueEvents.issueId, issueId))
      .orderBy(asc(issueEvents.createdAt), asc(issueEvents.id));
    const [issueTeam] = await this.db.select().from(teams).where(eq(teams.id, summary.teamId));
    const can = await this.deps.access.forTeam(viewerId, issueTeam!);
    const thread = await this.db
      .select({ comment: comments, authorName: members.name })
      .from(comments)
      .leftJoin(members, eq(members.id, comments.authorId))
      .where(and(eq(comments.subjectType, 'issue'), eq(comments.subjectId, issueId)))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    return {
      ...summary,
      comments: thread.map(({ comment, authorName }): CommentView => {
        const own = comment.authorId === viewerId;
        const deleted = comment.deletedAt !== null;
        return {
          id: comment.id,
          author: comment.authorId ? { id: comment.authorId, name: authorName ?? '' } : null,
          body: deleted ? null : comment.body,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          edited: comment.updatedAt.getTime() !== comment.createdAt.getTime(),
          deleted,
          canEdit: own && !deleted,
          canDelete: !deleted && (own || can.deleteAnyComment),
        };
      }),
      description: row!.description,
      createdBy: row!.createdBy ? { id: row!.createdBy, name: row!.creatorName ?? '' } : null,
      events: events.map(({ event, actorName }) => ({
        id: event.id,
        kind: event.kind,
        actor: event.actorId ? { id: event.actorId, name: actorName ?? '' } : null,
        changes: event.changes as IssueEvent['changes'],
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
