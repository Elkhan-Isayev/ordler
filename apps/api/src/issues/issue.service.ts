import {
  extractMentions,
  formatIssueIdentifier,
  parseIssueIdentifier,
  type CommentView,
  type SlackEvent,
  type CreateIssueData,
  type IssueDetail,
  type IssueEvent,
  type IssueField,
  type IssueSummary,
  type CycleRef,
  type LabelRef,
  type MemberRef,
  type LabelView,
  type TeamView,
  type TriageAction,
  type UpdateIssueInput,
} from '@ordler/shared';
import { aliasedTable, and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import {
  comments,
  cycles,
  departments,
  projectMilestones,
  projects,
  projectTeams,
  issueAssignees,
  issueEvents,
  issueLabels,
  issues,
  labels,
  members,
  teamMemberships,
  teams,
  workflowStatuses,
} from '../db/schema.js';
import type { Notifier } from '../notifications/notifier.js';
import type { ChannelItem } from '../notifications/slack.service.js';
import type { EventBus } from '../realtime/event-bus.js';
import type { TeamAccess, TeamPermissions } from './team-access.js';
import { teamStatuses } from './workflows.js';

type TeamRow = typeof teams.$inferSelect;

const assignee = aliasedTable(members, 'assignee');

/** Sub-issues in their chosen order; equal positions keep creation order (IT-3 before IT-4). */
function bySubOrder(list: IssueSummary[]): IssueSummary[] {
  return [...list].sort((a, b) => a.subOrder - b.subOrder || a.number - b.number);
}

/** Search text is literal: % and _ match themselves. */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Triage is recorded by its own action, not by field updates.
// Assignees and labels are lists and are compared separately.
const TRACKED: Array<
  Exclude<
    IssueField,
    'triage' | 'labelIds' | 'duplicateOf' | 'assigneeId' | 'assigneeIds' | 'imported'
  >
> = [
  'title',
  'description',
  'statusId',
  'priority',
  'dueDate',
  'parentId',
  'cycleId',
  'projectId',
  'milestoneId',
];

/** Slack channels of a team (SPEC §7.1); optional so tests can leave it out. */
export interface TeamChannels {
  publish(teamId: string, event: SlackEvent, item: ChannelItem): void;
}

export interface IssueServiceDeps {
  db: Db;
  access: TeamAccess;
  events: EventBus;
  notifier?: Notifier;
  channels?: TeamChannels;
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
      labels: await this.teamLabels(team.id),
      settings: { multipleAssignees: team.multipleAssignees },
      cycles: await this.openCycles(team.id),
      projects: await this.teamProjects(team.id),
      can: {
        create: can.create,
        update: can.update,
        assign: can.assign,
        comment: can.comment,
        delete: can.delete,
      },
    };
  }

  async list(memberId: string, key: string): Promise<IssueSummary[]> {
    const { team } = await this.readableTeam(memberId, key);
    return this.summaries(
      and(eq(issues.teamId, team.id), isNull(issues.archivedAt), eq(issues.inTriage, false)),
    );
  }

  /**
   * Search over titles, descriptions, comments and identifiers of issues in teams the member
   * can read (SPEC §5.4); permission-filtered before anything is matched.
   */
  async search(memberId: string, query: string, limit = 20): Promise<IssueSummary[]> {
    const all = await this.db.select().from(teams).where(isNull(teams.archivedAt));
    const readable: string[] = [];
    for (const team of all) {
      if ((await this.deps.access.forTeam(memberId, team)).read) readable.push(team.id);
    }
    if (readable.length === 0) return [];
    const pattern = `%${likeEscape(query)}%`;
    const parsed = parseIssueIdentifier(query.toUpperCase());
    const byIdentifier = parsed
      ? sql`((${teams.key} = ${parsed.teamKey} and ${issues.number} = ${parsed.number})
          or ${issues.externalKey} = ${query.toUpperCase()})`
      : sql`false`;
    const matches = await this.db
      .select({ id: issues.id })
      .from(issues)
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .where(
        and(
          inArray(issues.teamId, readable),
          isNull(issues.archivedAt),
          sql`(${byIdentifier} or ${issues.title} ilike ${pattern} or ${issues.description} ilike ${pattern}
            or exists (select 1 from ${comments} c where c.subject_type = 'issue' and c.subject_id = ${issues.id}
              and c.deleted_at is null and c.body ilike ${pattern}))`,
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(limit);
    if (matches.length === 0) return [];
    const found = await this.summaries(
      inArray(
        issues.id,
        matches.map((m) => m.id),
      ),
    );
    const order = new Map(matches.map((m, index) => [m.id, index]));
    return found.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  /**
   * Deletes an issue for everyone: it is archived, never erased, so history, comments and
   * links stay in the database and the audit log records who did it.
   */
  async remove(memberId: string, identifier: string, via?: string): Promise<void> {
    const { issueId, team, can } = await this.readableIssue(memberId, identifier);
    if (!can.delete) throw new DomainError('forbidden');
    await this.db
      .update(issues)
      .set({ archivedAt: this.now(), updatedAt: this.now() })
      .where(eq(issues.id, issueId));
    await writeAudit(this.db, {
      actor: { type: via === undefined ? 'member' : 'token', id: memberId },
      action: 'issue.deleted',
      targetType: 'issue',
      targetId: issueId,
      after: { identifier: identifier.toUpperCase(), ...(via === undefined ? {} : { via }) },
    });
    await this.deps.events.publish({ type: 'issue.removed', teamId: team.id, issueId });
  }

  /** Teams the member can read, for pickers such as a project's teams. */
  async readableTeams(
    memberId: string,
  ): Promise<Array<{ id: string; key: string; name: string; department: string }>> {
    const rows = await this.db
      .select({ team: teams, department: departments.name })
      .from(teams)
      .innerJoin(departments, eq(departments.id, teams.departmentId))
      .where(isNull(teams.archivedAt))
      .orderBy(asc(departments.name), asc(teams.name));
    const result = [];
    for (const { team, department } of rows) {
      if ((await this.deps.access.forTeam(memberId, team)).read) {
        result.push({ id: team.id, key: team.key, name: team.name, department });
      }
    }
    return result;
  }

  /** Issues from outside the team waiting for a decision (SPEC §5.2). */
  async triage(memberId: string, key: string): Promise<IssueSummary[]> {
    const { team } = await this.readableTeam(memberId, key);
    return this.summaries(
      and(eq(issues.teamId, team.id), isNull(issues.archivedAt), eq(issues.inTriage, true)),
    );
  }

  async decideTriage(
    memberId: string,
    identifier: string,
    decision: TriageAction,
  ): Promise<IssueDetail> {
    const { issueId, team, can } = await this.readableIssue(memberId, identifier);
    if (!can.update) throw new DomainError('forbidden');
    const [before] = await this.db.select().from(issues).where(eq(issues.id, issueId));
    if (!before!.inTriage) throw new DomainError('not_in_triage');

    const statuses = await teamStatuses(this.db, team.id);
    const changes: IssueEvent['changes'] = {};
    const patch: Partial<typeof issues.$inferInsert> = { inTriage: false };
    let assigneeList: string[] | undefined;
    if (decision.action === 'accept') {
      changes.triage = { from: 'pending', to: 'accepted' };
      if (decision.statusId !== undefined) {
        if (!statuses.some((s) => s.id === decision.statusId))
          throw new DomainError('status_not_in_workflow');
        patch.statusId = decision.statusId;
      }
      if (decision.assigneeId !== undefined) {
        if (!can.assign) throw new DomainError('forbidden');
        if (decision.assigneeId) await this.assertTeamMember(team.id, decision.assigneeId);
        patch.assigneeId = decision.assigneeId;
        assigneeList = decision.assigneeId ? [decision.assigneeId] : [];
      }
    } else if (decision.action === 'duplicate') {
      const original = await this.readableIssue(memberId, decision.of);
      if (original.issueId === issueId) throw new DomainError('invalid_parent');
      changes.triage = { from: 'pending', to: 'duplicate' };
      changes.duplicateOf = { from: null, to: original.issueId };
      patch.duplicateOfId = original.issueId;
      patch.statusId = statuses.find((s) => s.category === 'canceled')!.id;
    } else {
      changes.triage = { from: 'pending', to: 'declined' };
      patch.statusId = statuses.find((s) => s.category === 'canceled')!.id;
    }
    if (patch.statusId && patch.statusId !== before!.statusId) {
      changes.statusId = { from: before!.statusId, to: patch.statusId };
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== before!.assigneeId) {
      changes.assigneeId = { from: before!.assigneeId, to: patch.assigneeId };
    }

    const now = this.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set({ ...patch, updatedAt: now })
        .where(eq(issues.id, issueId));
      await tx
        .insert(issueEvents)
        .values({ issueId, actorId: memberId, kind: 'updated', changes, createdAt: now });
      if (assigneeList) await this.writeAssignees(tx, issueId, assigneeList);
      if (decision.action === 'decline') {
        // The reason stays with the issue, so whoever filed it can read why.
        await tx.insert(comments).values({
          subjectType: 'issue',
          subjectId: issueId,
          authorId: memberId,
          body: decision.reason,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    return this.detailById(issueId, memberId);
  }

  /** My issues: assigned to me, across every team I can still read. */
  async assignedTo(memberId: string): Promise<IssueSummary[]> {
    const all = await this.summaries(
      and(
        sql`exists (select 1 from ${issueAssignees} a where a.issue_id = ${issues.id}
          and a.member_id = ${memberId}::uuid)`,
        isNull(issues.archivedAt),
        isNull(teams.archivedAt),
      ),
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

  /** `via`: the personal token an agent used; recorded in history and the audit log. */
  async create(
    memberId: string,
    key: string,
    input: CreateIssueData,
    via?: string,
  ): Promise<IssueDetail> {
    const { team, can } = await this.readableTeam(memberId, key);
    if (!can.create) throw new DomainError('forbidden');
    const assigneeIds = (await this.resolveAssignees(team, input)) ?? [];
    if (assigneeIds.length > 0 && !can.assign) throw new DomainError('forbidden');

    const statuses = await teamStatuses(this.db, team.id);
    const statusId = input.statusId ?? (statuses.find((s) => s.isDefault) ?? statuses[0])!.id;
    if (!statuses.some((s) => s.id === statusId)) throw new DomainError('status_not_in_workflow');
    await this.assertLabels(team.id, input.labelIds);
    if (input.parentId) await this.assertParent(team.id, input.parentId);
    if (input.cycleId) await this.assertCycle(team.id, input.cycleId);
    const placement = await this.projectPlacement(team.id, input.projectId, input.milestoneId);

    // New sub-issues go last under their parent; read before the transaction holds the connection.
    const subOrder = input.parentId ? await this.nextSubOrder(input.parentId) : 0;
    const now = this.now();
    // Issues from outside the team wait in Triage until a member accepts them.
    const inTriage = !(await this.isTeamMember(team.id, memberId));
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
          assigneeId: assigneeIds[0] ?? null,
          dueDate: input.dueDate,
          // New issues go to the top of their column.
          sortOrder: (top?.min ?? 1) - 1,
          inTriage,
          parentId: input.parentId,
          cycleId: input.cycleId,
          projectId: placement.projectId,
          milestoneId: placement.milestoneId,
          subOrder,
          createdBy: memberId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: issues.id });
      await this.writeAssignees(tx, row!.id, assigneeIds);
      if (input.labelIds.length > 0) {
        await tx
          .insert(issueLabels)
          .values(input.labelIds.map((labelId) => ({ issueId: row!.id, labelId })));
      }
      await tx.insert(issueEvents).values({
        issueId: row!.id,
        actorId: memberId,
        kind: 'created',
        // The starting cycle is history too: burn-up charts count from it.
        changes: input.cycleId ? { cycleId: { from: null, to: input.cycleId } } : {},
        viaToken: via ?? null,
        createdAt: now,
      });
      return row!.id;
    });

    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    const created = await this.detailById(issueId, memberId);
    await this.auditVia(via, memberId, 'issue.created', issueId, {
      identifier: created.identifier,
    });
    this.toChannels(team.id, 'issue_created', created);
    await this.notifyMentions(memberId, team, issueId, input.description);
    if (assigneeIds.length > 0) {
      await this.deps.notifier?.notify({
        recipients: assigneeIds,
        kind: 'issue_assigned',
        actorId: memberId,
        subject: { type: 'issue', id: issueId },
      });
    }
    return created;
  }

  async get(memberId: string, identifier: string): Promise<IssueDetail> {
    const { issueId } = await this.readableIssue(memberId, identifier);
    return this.detailById(issueId, memberId);
  }

  async update(
    memberId: string,
    identifier: string,
    input: UpdateIssueInput,
    via?: string,
  ): Promise<IssueDetail> {
    const { issueId, team, can } = await this.readableIssue(memberId, identifier);
    const nextAssignees = await this.resolveAssignees(team, input);
    const touchesAssignee = nextAssignees !== undefined;
    const touchesOther = Object.keys(input).some(
      (field) => field !== 'assigneeId' && field !== 'assigneeIds',
    );
    if (touchesAssignee && !can.assign) throw new DomainError('forbidden');
    if (touchesOther && !can.update) throw new DomainError('forbidden');

    if (input.statusId !== undefined) {
      const statuses = await teamStatuses(this.db, team.id);
      if (!statuses.some((s) => s.id === input.statusId)) {
        throw new DomainError('status_not_in_workflow');
      }
    }
    if (input.labelIds) await this.assertLabels(team.id, input.labelIds);
    if (input.cycleId) await this.assertCycle(team.id, input.cycleId);
    // Project and milestone move together: a milestone implies its project, a new project
    // drops a milestone that belongs to another one.
    if (input.projectId !== undefined || input.milestoneId !== undefined) {
      const [current] = await this.db
        .select({ projectId: issues.projectId, milestoneId: issues.milestoneId })
        .from(issues)
        .where(eq(issues.id, issueId));
      const placement = await this.projectPlacement(
        team.id,
        input.projectId !== undefined ? input.projectId : current!.projectId,
        input.milestoneId !== undefined
          ? input.milestoneId
          : input.projectId !== undefined && input.projectId !== current!.projectId
            ? null
            : current!.milestoneId,
      );
      input = { ...input, projectId: placement.projectId, milestoneId: placement.milestoneId };
    }
    if (input.parentId) await this.assertParent(team.id, input.parentId, issueId);

    const [before] = await this.db.select().from(issues).where(eq(issues.id, issueId));
    const changes: IssueEvent['changes'] = {};
    const { labelIds, ...rest } = input;
    // Assignees are written through issue_assignees below, not as a plain column.
    const fields = Object.fromEntries(
      Object.entries(rest).filter(([key]) => key !== 'assigneeId' && key !== 'assigneeIds'),
    ) as Omit<typeof rest, 'assigneeId' | 'assigneeIds'>;
    const currentAssignees =
      (await this.assigneesOf([issueId])).get(issueId)?.map((a) => a.id) ?? [];
    const addedAssignees = (nextAssignees ?? []).filter((id) => !currentAssignees.includes(id));
    if (nextAssignees && nextAssignees.join() !== currentAssignees.join()) {
      // Single-assignee teams keep the familiar "assigned to X" history line.
      if (team.multipleAssignees)
        changes.assigneeIds = { from: currentAssignees, to: nextAssignees };
      else changes.assigneeId = { from: currentAssignees[0] ?? null, to: nextAssignees[0] ?? null };
    }
    if (labelIds) {
      const current = (await this.labelsOf([issueId])).get(issueId) ?? [];
      const from = current.map((l) => l.id).sort();
      const to = [...labelIds].sort();
      if (from.join() !== to.join()) changes.labelIds = { from, to };
    }
    for (const field of TRACKED) {
      const next = input[field];
      if (next === undefined || next === before![field]) continue;
      // Descriptions can be long; history records that it changed, not both versions.
      changes[field] =
        field === 'description' ? { from: null, to: null } : { from: before![field], to: next };
    }

    // Moved under another parent: last among its new siblings.
    const movedSubOrder =
      input.parentId && input.parentId !== before!.parentId && input.subOrder === undefined
        ? await this.nextSubOrder(input.parentId)
        : undefined;
    const now = this.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set({
          ...fields,
          ...(movedSubOrder !== undefined ? { subOrder: movedSubOrder } : {}),
          ...(nextAssignees ? { assigneeId: nextAssignees[0] ?? null } : {}),
          updatedAt: now,
        })
        .where(eq(issues.id, issueId));
      if (changes.assigneeId || changes.assigneeIds) {
        await this.writeAssignees(tx, issueId, nextAssignees!);
      }
      if (changes.labelIds) {
        await tx.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
        if (labelIds!.length > 0) {
          await tx.insert(issueLabels).values(labelIds!.map((labelId) => ({ issueId, labelId })));
        }
      }
      if (Object.keys(changes).length > 0) {
        await tx.insert(issueEvents).values({
          issueId,
          actorId: memberId,
          kind: 'updated',
          changes,
          viaToken: via ?? null,
          createdAt: now,
        });
      }
    });

    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    const updated = await this.detailById(issueId, memberId);
    await this.auditVia(via, memberId, 'issue.updated', issueId, {
      identifier: updated.identifier,
      fields: Object.keys(changes),
    });
    if (input.description !== undefined) {
      await this.notifyMentions(memberId, team, issueId, input.description, before!.description);
    }
    if (addedAssignees.length > 0) {
      this.toChannels(team.id, 'issue_assigned', updated);
      await this.deps.notifier?.notify({
        recipients: addedAssignees,
        kind: 'issue_assigned',
        actorId: memberId,
        subject: { type: 'issue', id: issueId },
      });
    }
    if (changes.statusId) {
      this.toChannels(team.id, 'issue_status_changed', updated);
      await this.deps.notifier?.notify({
        recipients: [before!.createdBy, ...updated.assignees.map((a) => a.id)].filter(
          (id): id is string => Boolean(id),
        ),
        kind: 'issue_status_changed',
        actorId: memberId,
        subject: { type: 'issue', id: issueId },
      });
    }
    return updated;
  }

  /** Posts to the team's Slack channels; the item is the team's own, so nothing leaks. */
  private toChannels(
    teamId: string,
    event: SlackEvent,
    issue: IssueDetail,
    excerpt?: string,
  ): void {
    if (!this.deps.channels) return;
    this.deps.channels.publish(teamId, event, {
      identifier: issue.identifier,
      title: issue.title,
      path: `/issue/${issue.identifier}`,
      context: [issue.status.name, issue.priority, issue.assignee?.name ?? ''].filter(
        (part) => part && part !== 'none',
      ),
      ...(excerpt ? { excerpt } : {}),
    });
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
        manage: false,
        delete: false,
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
    const [row] = await this.db
      .select({ id: issues.id })
      .from(issues)
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .where(
        and(
          eq(teams.key, parsed.teamKey),
          eq(issues.number, parsed.number),
          isNull(issues.archivedAt),
        ),
      );
    if (row) {
      const { team, can } = await this.readableTeam(memberId, parsed.teamKey);
      return { issueId: row.id, team, can };
    }
    // Imported issues answer to their old key too (SPEC §10.2); Ordler's own keys win.
    const [alias] = await this.db
      .select({ id: issues.id, teamKey: teams.key })
      .from(issues)
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .where(and(eq(issues.externalKey, identifier.toUpperCase()), isNull(issues.archivedAt)))
      .orderBy(asc(issues.createdAt))
      .limit(1);
    if (!alias) throw new DomainError('not_found');
    const { team, can } = await this.readableTeam(memberId, alias.teamKey);
    return { issueId: alias.id, team, can };
  }

  private async isTeamMember(teamId: string, memberId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: teamMemberships.memberId })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.memberId, memberId)));
    return row !== undefined;
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
    const labelMap = await this.labelsOf(rows.map((r) => r.issue.id));
    const assigneeMap = await this.assigneesOf(rows.map((r) => r.issue.id));
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
      assignees:
        assigneeMap.get(issue.id) ??
        (issue.assigneeId ? [{ id: issue.assigneeId, name: assigneeName ?? '' }] : []),
      dueDate: issue.dueDate,
      sortOrder: issue.sortOrder,
      inTriage: issue.inTriage,
      labels: labelMap.get(issue.id) ?? [],
      parentId: issue.parentId,
      subOrder: issue.subOrder,
      cycleId: issue.cycleId,
      projectId: issue.projectId,
      milestoneId: issue.milestoneId,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    }));
  }

  /** Assignees per issue in the order they were chosen; the first is `issues.assignee_id`. */
  private async assigneesOf(issueIds: string[]): Promise<Map<string, MemberRef[]>> {
    const map = new Map<string, MemberRef[]>();
    if (issueIds.length === 0) return map;
    const rows = await this.db
      .select({ issueId: issueAssignees.issueId, id: members.id, name: members.name })
      .from(issueAssignees)
      .innerJoin(members, eq(members.id, issueAssignees.memberId))
      .where(inArray(issueAssignees.issueId, issueIds))
      .orderBy(asc(issueAssignees.position));
    for (const { issueId, ...member } of rows) {
      map.set(issueId, [...(map.get(issueId) ?? []), member]);
    }
    return map;
  }

  /**
   * The assignee list an input asks for, or undefined when it does not touch assignees.
   * Teams with one assignee per issue refuse a longer list.
   */
  private async resolveAssignees(
    team: { id: string; multipleAssignees: boolean },
    input: { assigneeId?: string | null | undefined; assigneeIds?: string[] | undefined },
  ): Promise<string[] | undefined> {
    let ids: string[] | undefined;
    if (input.assigneeIds !== undefined) ids = [...new Set(input.assigneeIds)];
    else if (input.assigneeId !== undefined) ids = input.assigneeId ? [input.assigneeId] : [];
    if (!ids) return undefined;
    if (ids.length > 1 && !team.multipleAssignees) throw new DomainError('single_assignee');
    for (const id of ids) await this.assertTeamMember(team.id, id);
    return ids;
  }

  private async writeAssignees(db: Db, issueId: string, ids: string[]): Promise<void> {
    await db.delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
    if (ids.length > 0) {
      await db
        .insert(issueAssignees)
        .values(ids.map((memberId, position) => ({ issueId, memberId, position })));
    }
  }

  /** Labels per issue, sorted by name. */
  private async labelsOf(issueIds: string[]): Promise<Map<string, LabelRef[]>> {
    const map = new Map<string, LabelRef[]>();
    if (issueIds.length === 0) return map;
    const rows = await this.db
      .select({
        issueId: issueLabels.issueId,
        id: labels.id,
        name: labels.name,
        color: labels.color,
      })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(inArray(issueLabels.issueId, issueIds))
      .orderBy(asc(labels.name));
    for (const { issueId, ...label } of rows)
      map.set(issueId, [...(map.get(issueId) ?? []), label]);
    return map;
  }

  async teamLabels(teamId: string): Promise<LabelView[]> {
    const rows = await this.db
      .select()
      .from(labels)
      .where(or(eq(labels.teamId, teamId), isNull(labels.teamId)))
      .orderBy(asc(labels.name));
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      scope: l.teamId ? 'team' : 'organization',
    }));
  }

  /** Labels must be the team's own or organization-wide. */
  private async assertLabels(teamId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const allowed = new Set((await this.teamLabels(teamId)).map((l) => l.id));
    if (ids.some((id) => !allowed.has(id))) throw new DomainError('label_not_in_team');
  }

  /**
   * Tells people newly mentioned in `markdown` (SPEC §5.1 watchers). Only members who can read
   * the team hear about it, so a mention never reveals a private issue. Returns who was told.
   */
  private async notifyMentions(
    memberId: string,
    team: { id: string; isPrivate: boolean },
    issueId: string,
    markdown: string,
    before = '',
  ): Promise<string[]> {
    const already = new Set(extractMentions(before));
    const recipients: string[] = [];
    for (const id of extractMentions(markdown)) {
      if (already.has(id) || id === memberId) continue;
      if ((await this.deps.access.forTeam(id, team)).read) recipients.push(id);
    }
    if (recipients.length > 0) {
      await this.deps.notifier?.notify({
        recipients,
        kind: 'issue_mentioned',
        actorId: memberId,
        subject: { type: 'issue', id: issueId },
      });
    }
    return recipients;
  }

  /** Active projects of the team with their milestones, for pickers. */
  private async teamProjects(teamId: string): Promise<TeamView['projects']> {
    const rows = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projectTeams)
      .innerJoin(projects, eq(projects.id, projectTeams.projectId))
      .where(
        and(
          eq(projectTeams.teamId, teamId),
          isNull(projects.archivedAt),
          sql`${projects.status} not in ('completed', 'canceled')`,
        ),
      )
      .orderBy(asc(projects.name));
    if (rows.length === 0) return [];
    const milestones = await this.db
      .select({
        id: projectMilestones.id,
        name: projectMilestones.name,
        projectId: projectMilestones.projectId,
      })
      .from(projectMilestones)
      .where(
        inArray(
          projectMilestones.projectId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(projectMilestones.position));
    return rows.map((r) => ({
      ...r,
      milestones: milestones
        .filter((m) => m.projectId === r.id)
        .map(({ id, name }) => ({ id, name })),
    }));
  }

  /**
   * Checks a project/milestone pair for a team's issue: the project must include the team and
   * be live; a milestone must belong to it (and alone implies its project).
   */
  private async projectPlacement(
    teamId: string,
    projectId: string | null | undefined,
    milestoneId: string | null | undefined,
  ): Promise<{ projectId: string | null; milestoneId: string | null }> {
    let project = projectId ?? null;
    const milestone = milestoneId ?? null;
    if (milestone) {
      const [row] = await this.db
        .select({ projectId: projectMilestones.projectId })
        .from(projectMilestones)
        .where(eq(projectMilestones.id, milestone));
      if (!row || (project && row.projectId !== project))
        throw new DomainError('project_not_in_team');
      project = row.projectId;
    }
    if (project && !(await this.teamProjects(teamId)).some((p) => p.id === project)) {
      throw new DomainError('project_not_in_team');
    }
    return { projectId: project, milestoneId: milestone };
  }

  /** Current and upcoming cycles, so pickers never offer a finished one. */
  private async openCycles(teamId: string): Promise<CycleRef[]> {
    const today = this.now().toISOString().slice(0, 10);
    const rows = await this.db
      .select()
      .from(cycles)
      .where(and(eq(cycles.teamId, teamId), sql`${cycles.endsOn} >= ${today}`))
      .orderBy(asc(cycles.startsOn));
    return rows.map((c) => ({
      id: c.id,
      number: c.number,
      name: c.name,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      state: c.startsOn > today ? 'upcoming' : 'current',
    }));
  }

  /** Only the team's own cycles that have not ended can take issues. */
  private async assertCycle(teamId: string, cycleId: string): Promise<void> {
    if (!(await this.openCycles(teamId)).some((c) => c.id === cycleId)) {
      throw new DomainError('cycle_not_in_team');
    }
  }

  private async nextSubOrder(parentId: string): Promise<number> {
    const [row] = await this.db
      .select({ max: sql<number | null>`max(${issues.subOrder})` })
      .from(issues)
      .where(eq(issues.parentId, parentId));
    return (row?.max ?? 0) + 1;
  }

  /** Root first; bounded so damaged data can never loop forever. */
  private async ancestorsOf(
    parentId: string | null,
  ): Promise<Array<{ id: string; identifier: string; title: string }>> {
    const chain: Array<{ id: string; identifier: string; title: string }> = [];
    for (let current = parentId; current && chain.length < 20;) {
      const found = await this.summary(current);
      if (!found) break;
      chain.unshift({ id: found.id, identifier: found.identifier, title: found.title });
      current = found.parentId;
    }
    return chain;
  }

  /** Same team, and never an ancestor loop (an issue cannot sit under its own sub-issue). */
  private async assertParent(teamId: string, parentId: string, issueId?: string): Promise<void> {
    let current: string | null = parentId;
    for (let depth = 0; current; depth += 1) {
      if (current === issueId || depth > 100) throw new DomainError('invalid_parent');
      const [row] = await this.db
        .select({ teamId: issues.teamId, parentId: issues.parentId, archivedAt: issues.archivedAt })
        .from(issues)
        .where(eq(issues.id, current));
      if (!row || row.teamId !== teamId || (depth === 0 && row.archivedAt)) {
        throw new DomainError('invalid_parent');
      }
      current = row.parentId;
    }
  }

  async addComment(
    memberId: string,
    identifier: string,
    body: string,
    via?: string,
  ): Promise<IssueDetail> {
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
    const detail = await this.detailById(issueId, memberId);
    await this.auditVia(via, memberId, 'issue.commented', issueId, {
      identifier: detail.identifier,
    });
    this.toChannels(team.id, 'issue_commented', detail, body);
    // Watchers: whoever filed, owns or discussed the issue (SPEC §5.1).
    const [row] = await this.db
      .select({ createdBy: issues.createdBy })
      .from(issues)
      .where(eq(issues.id, issueId));
    const mentioned = await this.notifyMentions(memberId, team, issueId, body);
    await this.deps.notifier?.notify({
      // Mentioned people already got a more specific notification.
      recipients: [
        row?.createdBy,
        ...detail.assignees.map((a) => a.id),
        ...detail.comments.map((c) => c.author?.id),
      ].filter((id): id is string => Boolean(id) && !mentioned.includes(id!)),
      kind: 'issue_commented',
      actorId: memberId,
      subject: { type: 'issue', id: issueId },
    });
    return detail;
  }

  async editComment(memberId: string, commentId: string, body: string): Promise<IssueDetail> {
    const { comment, issueId, team } = await this.readableComment(memberId, commentId);
    // Only the author may change their words; nobody can rewrite someone else's comment.
    if (comment.authorId !== memberId || comment.deletedAt) throw new DomainError('forbidden');
    const now = this.now();
    await this.db.update(comments).set({ body, updatedAt: now }).where(eq(comments.id, commentId));
    await this.db.update(issues).set({ updatedAt: now }).where(eq(issues.id, issueId));
    await this.deps.events.publish({ type: 'issue.changed', teamId: team.id, issueId });
    await this.notifyMentions(memberId, team, issueId, body, comment.body);
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
    const parent = summary.parentId ? await this.summary(summary.parentId) : undefined;
    const children = bySubOrder(
      await this.summaries(and(eq(issues.parentId, issueId), isNull(issues.archivedAt))),
    );
    const [{ duplicateOfId } = { duplicateOfId: null }] = await this.db
      .select({ duplicateOfId: issues.duplicateOfId })
      .from(issues)
      .where(eq(issues.id, issueId));
    const original = duplicateOfId ? await this.summary(duplicateOfId) : undefined;
    return {
      ...summary,
      parent: parent ? { id: parent.id, identifier: parent.identifier, title: parent.title } : null,
      duplicateOf: original ? { identifier: original.identifier, title: original.title } : null,
      children,
      grandchildren:
        children.length === 0
          ? []
          : bySubOrder(
              await this.summaries(
                and(
                  inArray(
                    issues.parentId,
                    children.map((c) => c.id),
                  ),
                  isNull(issues.archivedAt),
                ),
              ),
            ),
      ancestors: await this.ancestorsOf(summary.parentId),
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
        viaToken: event.viaToken,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  /** Agent writes are audited as the member via that token; UI writes stay in history only. */
  private async auditVia(
    via: string | undefined,
    memberId: string,
    action: string,
    issueId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    if (via === undefined) return;
    await writeAudit(this.db, {
      actor: { type: 'token', id: memberId },
      action,
      targetType: 'issue',
      targetId: issueId,
      after: { ...after, via },
    });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
