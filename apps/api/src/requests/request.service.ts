import { createHash } from 'node:crypto';
import {
  can,
  formatGroupIdentifier,
  formatIssueIdentifier,
  formatRequestIdentifier,
  isFinalRequestStatus,
  ORGANIZATION_SCOPE,
  parseGroupIdentifier,
  parseRequestIdentifier,
  validateFormData,
  type ApprovalDecisionInput,
  type ApprovalStepInput,
  type ApprovalStepView,
  type ApproverSelector,
  type CreateRequestGroupInput,
  type CreateRequestInput,
  type FormField,
  type PendingApproval,
  type Permission,
  type RequestAction,
  type RequestFormData,
  type RequesterAction,
  type RequestGroupView,
  type RequestStatus,
  type RequestSummary,
  type RequestView,
  type ResubmitRequestInput,
  type Scope,
} from '@ordler/shared';
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import {
  approvalDecisions,
  approvalSteps,
  comments,
  counters,
  departments,
  issues,
  members,
  requestEvents,
  requestGroups,
  requests,
  requestTypes,
  teamMemberships,
  teams,
  workflowStatuses,
} from '../db/schema.js';
import { likeEscape, type IssueService, type TeamChannels } from '../issues/issue.service.js';
import type { EventBus } from '../realtime/event-bus.js';
import type { TeamAccess } from '../issues/team-access.js';
import type { Notifier } from '../notifications/notifier.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';
import { resolveApprovers, selectorNames } from './approvers.js';

type RequestRow = typeof requests.$inferSelect;
type StepRow = typeof approvalSteps.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const requester = aliasedTable(members, 'requester');
const assignee = aliasedTable(members, 'assignee');

/** Who is asking: a signed-in session, or a personal token (which may never decide approvals). */
export interface Actor {
  memberId: string;
  tokenName?: string | undefined;
}

export interface RequestServiceDeps {
  db: Db;
  access: AccessContextSource;
  teamAccess: TeamAccess;
  issues: IssueService;
  notifier: Notifier;
  events?: EventBus;
  channels?: TeamChannels;
  now?: () => Date;
}

interface Perspective {
  isRequester: boolean;
  isAgent: boolean;
  isApprover: boolean;
  can: RequestView['can'];
}

/**
 * Cross-department requests (SPEC §6): submission through a request type's form, sequential
 * approval steps with segregation of duties, the receiving team's lifecycle, and request
 * groups that send one request to several departments.
 */
export class RequestService {
  constructor(private readonly deps: RequestServiceDeps) {}

  private get db(): Db {
    return this.deps.db;
  }

  // -------------------------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------------------------

  async submit(actor: Actor, input: CreateRequestInput): Promise<RequestView> {
    await this.assertCanRequest(actor.memberId);
    const type = await this.activeType(input.requestTypeId);
    const formData = this.validForm(type.fields as FormField[], input.formData);
    if (input.extraApprovals.length > 0 && !type.allowRequesterApprovals) {
      throw new DomainError('approvals_not_allowed');
    }

    const requestId = await this.db.transaction(async (tx) => {
      const id = await this.insertRequest(tx, actor, {
        type,
        title: input.title,
        description: input.description,
        priority: input.priority,
        formData,
        groupId: null,
      });
      // Mandatory steps first, then the ones the requester added (SPEC §6.3 example).
      await this.insertSteps(tx, { requestId: id }, [
        ...(type.approvalSteps as ApprovalStepInput[]).map((s) => ({
          ...s,
          origin: 'mandatory' as const,
        })),
        ...input.extraApprovals.map((s) => ({ ...s, origin: 'requester_added' as const })),
      ]);
      return id;
    });

    await this.advance(requestId, actor.memberId);
    await this.changed(requestId);
    return this.view(actor.memberId, requestId);
  }

  /** One request to several departments (§6.4). Requester-added approvals cover the group. */
  async submitGroup(actor: Actor, input: CreateRequestGroupInput): Promise<RequestGroupView> {
    await this.assertCanRequest(actor.memberId);
    const types = await Promise.all(input.items.map((item) => this.activeType(item.requestTypeId)));
    if (new Set(types.map((t) => t.departmentId)).size !== types.length) {
      // One child per department: the whole point is that each department gets its own.
      throw new DomainError('validation_failed');
    }
    const forms = input.items.map((item, i) =>
      this.validForm(types[i]!.fields as FormField[], item.formData),
    );
    if (input.extraApprovals.length > 0 && !types.every((t) => t.allowRequesterApprovals)) {
      throw new DomainError('approvals_not_allowed');
    }

    const { groupId, childIds } = await this.db.transaction(async (tx) => {
      const number = await this.nextNumber(tx, 'request_group');
      const [group] = await tx
        .insert(requestGroups)
        .values({ number, requesterId: actor.memberId, title: input.title, createdAt: this.now() })
        .returning({ id: requestGroups.id });
      await this.insertSteps(
        tx,
        { groupId: group!.id },
        input.extraApprovals.map((s) => ({ ...s, origin: 'requester_added' as const })),
      );
      const ids: string[] = [];
      for (const [i, type] of types.entries()) {
        const id = await this.insertRequest(tx, actor, {
          type,
          title: input.title,
          description: input.description,
          priority: input.priority,
          formData: forms[i]!,
          groupId: group!.id,
        });
        await this.insertSteps(
          tx,
          { requestId: id },
          (type.approvalSteps as ApprovalStepInput[]).map((s) => ({
            ...s,
            origin: 'mandatory' as const,
          })),
        );
        ids.push(id);
      }
      return { groupId: group!.id, childIds: ids };
    });

    await this.advanceGroup(groupId, childIds, actor.memberId);
    return this.groupView(actor.memberId, groupId);
  }

  // -------------------------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------------------------

  /** Approval decisions need a signed-in human; tokens and MCP can never decide (§6.3, §10.1). */
  async decide(
    actor: Actor,
    stepId: string,
    input: ApprovalDecisionInput,
  ): Promise<{ request?: RequestView; group?: RequestGroupView }> {
    if (actor.tokenName !== undefined) throw new DomainError('session_required');
    if (!/^[0-9a-f-]{36}$/.test(stepId)) throw new DomainError('not_found');
    const [step] = await this.db.select().from(approvalSteps).where(eq(approvalSteps.id, stepId));
    if (!step) throw new DomainError('not_found');
    if (!step.resolvedApproverIds.includes(actor.memberId)) {
      // Hide steps of requests the member cannot see at all.
      if (!(await this.canSeeStep(actor.memberId, step))) throw new DomainError('not_found');
      throw new DomainError('not_an_approver');
    }
    if (step.status !== 'active') throw new DomainError('step_not_active');
    if (step.groupId && input.decision === 'request_changes')
      throw new DomainError('invalid_transition');

    const subject = step.requestId
      ? (await this.db.select().from(requests).where(eq(requests.id, step.requestId)))[0]!
      : undefined;
    const group = step.groupId
      ? (await this.db.select().from(requestGroups).where(eq(requestGroups.id, step.groupId)))[0]!
      : undefined;
    const requesterId = subject?.requesterId ?? group?.requesterId;
    // Segregation of duties, checked again at decision time.
    if (requesterId === actor.memberId) throw new DomainError('not_an_approver');

    const decided = await this.decisionsSinceActivation(step);
    if (decided.some((d) => d.approverId === actor.memberId))
      throw new DomainError('already_decided');

    const snapshot = subject
      ? snapshotHash(subject)
      : snapshotHash({ title: group!.title, description: '', formData: {} });
    const now = this.now();
    await this.db.insert(approvalDecisions).values({
      stepId,
      approverId: actor.memberId,
      decision: input.decision,
      comment: input.comment ?? null,
      snapshotHash: snapshot,
      createdAt: now,
    });
    await writeAudit(this.db, {
      actor: { type: 'member', id: actor.memberId },
      action: 'approval.decided',
      targetType: step.requestId ? 'request' : 'request_group',
      targetId: step.requestId ?? step.groupId,
      // "snapshotSha256", not "...Hash": audit redaction hides keys that look like secrets.
      after: {
        stepId,
        decision: input.decision,
        comment: input.comment ?? null,
        snapshotSha256: snapshot,
      },
    });

    const approvals = [...decided, { approverId: actor.memberId, decision: input.decision }];
    const outcome =
      input.decision === 'reject'
        ? 'rejected'
        : input.decision === 'request_changes'
          ? 'changes_requested'
          : step.rule === 'any' ||
              step.resolvedApproverIds.every((id) =>
                approvals.some((a) => a.approverId === id && a.decision === 'approve'),
              )
            ? 'approved'
            : undefined;

    if (outcome) {
      await this.db
        .update(approvalSteps)
        .set({ status: outcome, completedAt: now })
        .where(eq(approvalSteps.id, stepId));
    }

    if (subject) {
      await this.event(subject.id, actor.memberId, 'approval_decided', {
        stepId,
        decision: input.decision,
        comment: input.comment ?? null,
      });
      if (outcome === 'rejected') {
        await this.setStatus(subject, 'rejected', actor.memberId);
        await this.notifyRequester(subject, 'request_rejected', actor.memberId, {
          comment: input.comment,
        });
      } else if (outcome === 'changes_requested') {
        await this.setStatus(subject, 'changes_requested', actor.memberId);
        await this.notifyRequester(subject, 'request_changes_requested', actor.memberId, {
          comment: input.comment,
        });
      } else if (outcome === 'approved') {
        await this.notifyRequester(subject, 'approval_decided', actor.memberId, {
          decision: 'approve',
        });
        await this.advance(subject.id, actor.memberId);
      }
      this.toChannels(await this.fresh(subject.id), 'approval_decided');
      await this.changed(subject.id);
      return { request: await this.view(actor.memberId, subject.id) };
    }

    const children = await this.db.select().from(requests).where(eq(requests.groupId, group!.id));
    if (outcome === 'rejected') {
      // A group-level rejection rejects every child (§6.4).
      for (const child of children) {
        await this.event(child.id, actor.memberId, 'approval_decided', {
          stepId,
          decision: 'reject',
          comment: input.comment ?? null,
        });
        await this.setStatus(child, 'rejected', actor.memberId);
      }
      await this.deps.notifier.notify({
        recipients: group!.requesterId ? [group!.requesterId] : [],
        kind: 'request_rejected',
        actorId: actor.memberId,
        subject: { type: 'request_group', id: group!.id },
        data: { comment: input.comment ?? null },
      });
    } else if (outcome === 'approved') {
      await this.advanceGroup(
        group!.id,
        children.map((c) => c.id),
        actor.memberId,
      );
    }
    return { group: await this.groupView(actor.memberId, group!.id) };
  }

  async pendingApprovals(memberId: string): Promise<PendingApproval[]> {
    const steps = await this.db
      .select()
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.status, 'active'),
          sql`${memberId}::uuid = any(${approvalSteps.resolvedApproverIds})`,
        ),
      )
      .orderBy(asc(approvalSteps.activatedAt));
    const result: PendingApproval[] = [];
    for (const step of steps) {
      if ((await this.decisionsSinceActivation(step)).some((d) => d.approverId === memberId))
        continue;
      const names = await selectorNames(this.db, step.selector as ApproverSelector);
      let request: PendingApproval['request'] = null;
      let group: PendingApproval['group'] = null;
      if (step.requestId) {
        const [summary] = await this.summaries(eq(requests.id, step.requestId));
        if (summary) {
          request = {
            identifier: summary.identifier,
            title: summary.title,
            requester: summary.requester,
            department: summary.department,
          };
        }
      } else if (step.groupId) {
        const [row] = await this.db
          .select()
          .from(requestGroups)
          .where(eq(requestGroups.id, step.groupId));
        if (row) group = { identifier: formatGroupIdentifier(row.number), title: row.title };
      }
      result.push({
        stepId: step.id,
        selector: step.selector as ApproverSelector,
        names,
        request,
        group,
        activatedAt: (step.activatedAt ?? new Date(0)).toISOString(),
      });
    }
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  async act(actor: Actor, identifier: string, action: RequestAction): Promise<RequestView> {
    const row = await this.byIdentifier(identifier);
    const perspective = await this.perspective(actor.memberId, row);
    if (!perspective.isAgent && !perspective.isRequester && !perspective.isApprover) {
      throw new DomainError('not_found');
    }
    if (!perspective.can.act) throw new DomainError('forbidden');

    const transitions: Record<string, RequestStatus[]> = {
      accept: ['open'],
      decline: ['open', 'in_progress', 'waiting_for_requester'],
      wait_for_requester: ['in_progress'],
      resume: ['waiting_for_requester'],
      resolve: ['in_progress', 'waiting_for_requester'],
      assign: ['open', 'in_progress', 'waiting_for_requester', 'resolved'],
      priority: ['open', 'in_progress', 'waiting_for_requester', 'resolved'],
    };
    if (!transitions[action.action]!.includes(row.status))
      throw new DomainError('invalid_transition');

    switch (action.action) {
      case 'accept':
        if (action.assigneeId) await this.assertTeamMember(row.targetTeamId, action.assigneeId);
        await this.db
          .update(requests)
          .set({ assigneeId: action.assigneeId ?? row.assigneeId, updatedAt: this.now() })
          .where(eq(requests.id, row.id));
        await this.setStatus(row, 'in_progress', actor.memberId, 'accepted');
        break;
      case 'decline':
        await this.addComment(row.id, actor.memberId, action.reason, false);
        await this.setStatus(row, 'declined', actor.memberId, 'declined');
        break;
      case 'wait_for_requester':
        await this.addComment(row.id, actor.memberId, action.comment, false);
        await this.setStatus(row, 'waiting_for_requester', actor.memberId);
        break;
      case 'resume':
        await this.setStatus(row, 'in_progress', actor.memberId);
        break;
      case 'resolve':
        if (action.comment) await this.addComment(row.id, actor.memberId, action.comment, false);
        await this.setStatus(row, 'resolved', actor.memberId);
        break;
      case 'assign':
        if (action.assigneeId) await this.assertTeamMember(row.targetTeamId, action.assigneeId);
        await this.db
          .update(requests)
          .set({ assigneeId: action.assigneeId, updatedAt: this.now() })
          .where(eq(requests.id, row.id));
        await this.event(row.id, actor.memberId, 'assigned', { to: action.assigneeId });
        break;
      case 'priority':
        await this.db
          .update(requests)
          .set({ priority: action.priority, updatedAt: this.now() })
          .where(eq(requests.id, row.id));
        await this.event(row.id, actor.memberId, 'priority', { to: action.priority });
        break;
    }
    if (['accept', 'decline', 'wait_for_requester', 'resolve'].includes(action.action)) {
      await this.notifyRequester(row, 'request_status_changed', actor.memberId, {
        action: action.action,
      });
    }
    return this.view(actor.memberId, row.id);
  }

  async requesterAct(
    actor: Actor,
    identifier: string,
    action: RequesterAction,
  ): Promise<RequestView> {
    const row = await this.byIdentifier(identifier);
    if (row.requesterId !== actor.memberId) {
      if (!(await this.canSee(actor.memberId, row))) throw new DomainError('not_found');
      throw new DomainError('forbidden');
    }
    if (row.status !== 'resolved') throw new DomainError('invalid_transition');
    if (action.action === 'confirm') {
      await this.setStatus(row, 'closed', actor.memberId);
    } else {
      await this.addComment(row.id, actor.memberId, action.comment, false);
      await this.setStatus(row, 'in_progress', actor.memberId, 'reopened');
    }
    await this.changed(row.id);
    return this.view(actor.memberId, row.id);
  }

  /** After "changes requested" the requester edits and sends the request back to the same step. */
  async resubmit(
    actor: Actor,
    identifier: string,
    input: ResubmitRequestInput,
  ): Promise<RequestView> {
    const row = await this.byIdentifier(identifier);
    if (row.requesterId !== actor.memberId) {
      if (!(await this.canSee(actor.memberId, row))) throw new DomainError('not_found');
      throw new DomainError('forbidden');
    }
    if (row.status !== 'changes_requested') throw new DomainError('invalid_transition');
    const [type] = await this.db
      .select()
      .from(requestTypes)
      .where(eq(requestTypes.id, row.requestTypeId));
    const formData = input.formData
      ? this.validForm(type!.fields as FormField[], input.formData)
      : (row.formData as RequestFormData);

    const now = this.now();
    await this.db
      .update(requests)
      .set({
        title: input.title ?? row.title,
        description: input.description ?? row.description,
        formData,
        status: 'pending_approval',
        updatedAt: now,
      })
      .where(eq(requests.id, row.id));
    const [step] = await this.db
      .select()
      .from(approvalSteps)
      .where(
        and(eq(approvalSteps.requestId, row.id), eq(approvalSteps.status, 'changes_requested')),
      );
    await this.event(row.id, actor.memberId, 'resubmitted', {});
    if (step) {
      // The step starts over: earlier decisions stay in history but no longer count.
      await this.activateStep(step, await this.fresh(row.id), actor.memberId);
    }
    await this.changed(row.id);
    return this.view(actor.memberId, row.id);
  }

  async comment(
    actor: Actor,
    identifier: string,
    input: { body: string; internal: boolean },
  ): Promise<RequestView> {
    const row = await this.byIdentifier(identifier);
    const perspective = await this.perspective(actor.memberId, row);
    if (!perspective.isAgent && !perspective.isRequester && !perspective.isApprover) {
      throw new DomainError('not_found');
    }
    if (input.internal ? !perspective.can.commentInternal : !perspective.can.commentPublic) {
      throw new DomainError('forbidden');
    }
    await this.addComment(row.id, actor.memberId, input.body, input.internal);
    // A requester's reply brings a waiting request back to the team.
    if (perspective.isRequester && !perspective.isAgent && row.status === 'waiting_for_requester') {
      await this.setStatus(row, 'in_progress', actor.memberId);
    }
    const recipients = new Set<string>();
    if (!input.internal && row.requesterId && row.requesterId !== actor.memberId) {
      recipients.add(row.requesterId);
    }
    if (row.assigneeId && row.assigneeId !== actor.memberId) recipients.add(row.assigneeId);
    await this.deps.notifier.notify({
      recipients: [...recipients],
      kind: 'request_commented',
      actorId: actor.memberId,
      subject: { type: 'request', id: row.id },
    });
    await this.changed(row.id);
    return this.view(actor.memberId, row.id);
  }

  /** Creates an issue in the receiving team, linked to the request. */
  async spawnIssue(actor: Actor, identifier: string, title?: string): Promise<RequestView> {
    const row = await this.byIdentifier(identifier);
    const perspective = await this.perspective(actor.memberId, row);
    if (!perspective.isAgent) throw new DomainError('not_found');
    if (!perspective.can.spawnIssue) throw new DomainError('forbidden');
    const [team] = await this.db.select().from(teams).where(eq(teams.id, row.targetTeamId));
    const created = await this.deps.issues.create(actor.memberId, team!.key, {
      title: title?.trim() || row.title,
      description: `${formatRequestIdentifier(row.number)}\n\n${row.description}`.trim(),
      priority: row.priority,
      assigneeId: null,
      dueDate: null,
      labelIds: [],
      parentId: null,
      cycleId: null,
    });
    await this.db.update(issues).set({ sourceRequestId: row.id }).where(eq(issues.id, created.id));
    await this.event(row.id, actor.memberId, 'issue_spawned', { identifier: created.identifier });
    await this.changed(row.id);
    return this.view(actor.memberId, row.id);
  }

  /** Links an existing issue of the receiving team. */
  async linkIssue(actor: Actor, identifier: string, issueIdentifier: string): Promise<RequestView> {
    const row = await this.byIdentifier(identifier);
    const perspective = await this.perspective(actor.memberId, row);
    if (!perspective.isAgent) throw new DomainError('not_found');
    if (!perspective.can.spawnIssue) throw new DomainError('forbidden');
    const detail = await this.deps.issues.get(actor.memberId, issueIdentifier);
    if (detail.teamId !== row.targetTeamId) throw new DomainError('validation_failed');
    await this.db.update(issues).set({ sourceRequestId: row.id }).where(eq(issues.id, detail.id));
    await this.event(row.id, actor.memberId, 'issue_linked', { identifier: detail.identifier });
    await this.changed(row.id);
    return this.view(actor.memberId, row.id);
  }

  // -------------------------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------------------------

  async get(memberId: string, identifier: string): Promise<RequestView> {
    const row = await this.byIdentifier(identifier);
    if (!(await this.canSee(memberId, row))) throw new DomainError('not_found');
    return this.view(memberId, row.id);
  }

  async getGroup(memberId: string, identifier: string): Promise<RequestGroupView> {
    const number = parseGroupIdentifier(identifier);
    if (!number) throw new DomainError('not_found');
    const [group] = await this.db
      .select()
      .from(requestGroups)
      .where(eq(requestGroups.number, number));
    if (!group) throw new DomainError('not_found');
    return this.groupView(memberId, group.id);
  }

  /**
   * Requests the member may open whose title, description or identifier matches; comments are
   * not searched so internal notes can never surface to requesters.
   */
  async search(memberId: string, query: string, limit = 20): Promise<RequestSummary[]> {
    const pattern = `%${likeEscape(query)}%`;
    const number = parseRequestIdentifier(query);
    const candidates = await this.db
      .select()
      .from(requests)
      .where(
        sql`(${number ? sql`${requests.number} = ${number}` : sql`false`}
          or ${requests.title} ilike ${pattern} or ${requests.description} ilike ${pattern})`,
      )
      .orderBy(desc(requests.updatedAt))
      .limit(200);
    const visible: string[] = [];
    for (const row of candidates) {
      if (visible.length >= limit) break;
      if (await this.canSee(memberId, row)) visible.push(row.id);
    }
    if (visible.length === 0) return [];
    const found = await this.summaries(inArray(requests.id, visible), true);
    const order = new Map(visible.map((id, index) => [id, index]));
    return found.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  async mine(memberId: string): Promise<RequestSummary[]> {
    return this.summaries(eq(requests.requesterId, memberId), true);
  }

  /** The receiving team's queue: everything routed to the team, newest first. */
  async teamQueue(memberId: string, teamKey: string): Promise<RequestSummary[]> {
    const [team] = await this.db.select().from(teams).where(eq(teams.key, teamKey.toUpperCase()));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    if (!(await this.deps.teamAccess.forTeam(memberId, team)).read)
      throw new DomainError('not_found');
    return this.summaries(
      and(
        eq(requests.targetTeamId, team.id),
        // Requests still in (or stopped at) approval never reached the team.
        sql`${requests.status} not in ('pending_approval', 'changes_requested', 'rejected')`,
      ),
      true,
    );
  }

  /** Every request routed to a department, for its admins and supervisors. */
  async departmentQueue(memberId: string, departmentId: string): Promise<RequestSummary[]> {
    if (!/^[0-9a-f-]{36}$/.test(departmentId)) throw new DomainError('not_found');
    const scope: Scope = { type: 'department', id: departmentId };
    if (!(await this.has(memberId, 'request.read_department', scope)))
      throw new DomainError('forbidden');
    return this.summaries(eq(requests.targetDepartmentId, departmentId), true);
  }

  // -------------------------------------------------------------------------------------------
  // Engine
  // -------------------------------------------------------------------------------------------

  /** Activates the next waiting step, or releases the request to its team when none is left. */
  private async advance(requestId: string, actorId: string): Promise<void> {
    const row = await this.fresh(requestId);
    if (row.status !== 'pending_approval' && row.status !== 'open') return;
    const steps = await this.db
      .select()
      .from(approvalSteps)
      .where(eq(approvalSteps.requestId, requestId))
      .orderBy(asc(approvalSteps.position));
    if (steps.some((s) => s.status === 'active')) return;
    const next = steps.find((s) => s.status === 'waiting');
    if (next) {
      if (row.status !== 'pending_approval') await this.setStatus(row, 'pending_approval', actorId);
      await this.activateStep(next, await this.fresh(requestId), actorId);
      return;
    }
    if (row.status === 'pending_approval') await this.setStatus(row, 'open', actorId, 'released');
    else await this.event(row.id, actorId, 'released', {});
    await this.notifyTeam(await this.fresh(requestId), actorId);
  }

  private async advanceGroup(groupId: string, childIds: string[], actorId: string): Promise<void> {
    const steps = await this.db
      .select()
      .from(approvalSteps)
      .where(eq(approvalSteps.groupId, groupId))
      .orderBy(asc(approvalSteps.position));
    if (steps.some((s) => s.status === 'active' || s.status === 'rejected')) return;
    const next = steps.find((s) => s.status === 'waiting');
    const [group] = await this.db.select().from(requestGroups).where(eq(requestGroups.id, groupId));
    if (next) {
      const [first] = await this.db.select().from(requests).where(eq(requests.id, childIds[0]!));
      await this.activateGroupStep(next, group!, first!, actorId);
      return;
    }
    // Group approvals done: every child continues with its own department's steps.
    for (const id of childIds) await this.advance(id, actorId);
  }

  private async activateStep(step: StepRow, row: RequestRow, actorId: string): Promise<void> {
    const approvers = await resolveApprovers(this.db, step.selector as ApproverSelector, {
      requesterId: row.requesterId ?? '',
      requesterDepartmentId: row.requesterDepartmentId,
      targetDepartmentId: row.targetDepartmentId,
    });
    await this.db
      .update(approvalSteps)
      .set({
        status: 'active',
        resolvedApproverIds: approvers,
        activatedAt: this.now(),
        completedAt: null,
      })
      .where(eq(approvalSteps.id, step.id));
    await this.event(row.id, actorId, 'approval_requested', { stepId: step.id });
    this.toChannels(row, 'approval_requested');
    await this.deps.notifier.notify({
      recipients: approvers,
      kind: 'approval_requested',
      actorId,
      subject: { type: 'request', id: row.id },
      data: { stepId: step.id },
    });
  }

  private async activateGroupStep(
    step: StepRow,
    group: typeof requestGroups.$inferSelect,
    child: RequestRow,
    actorId: string,
  ): Promise<void> {
    const approvers = await resolveApprovers(this.db, step.selector as ApproverSelector, {
      requesterId: group.requesterId ?? '',
      requesterDepartmentId: child.requesterDepartmentId,
      targetDepartmentId: child.targetDepartmentId,
    });
    await this.db
      .update(approvalSteps)
      .set({ status: 'active', resolvedApproverIds: approvers, activatedAt: this.now() })
      .where(eq(approvalSteps.id, step.id));
    await this.deps.notifier.notify({
      recipients: approvers,
      kind: 'approval_requested',
      actorId,
      subject: { type: 'request_group', id: group.id },
      data: { stepId: step.id },
    });
  }

  private async insertRequest(
    tx: Tx,
    actor: Actor,
    input: {
      type: typeof requestTypes.$inferSelect;
      title: string;
      description: string;
      priority: RequestSummary['priority'];
      formData: RequestFormData;
      groupId: string | null;
    },
  ): Promise<string> {
    const number = await this.nextNumber(tx, 'request');
    const now = this.now();
    const [row] = await tx
      .insert(requests)
      .values({
        number,
        groupId: input.groupId,
        requestTypeId: input.type.id,
        requesterId: actor.memberId,
        requesterDepartmentId: await this.requesterDepartment(tx, actor.memberId),
        targetDepartmentId: input.type.departmentId,
        targetTeamId: input.type.targetTeamId,
        title: input.title,
        description: input.description,
        formData: input.formData,
        // Every request starts pending; advance() releases it when no step is left.
        status: 'pending_approval',
        priority: input.priority,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: requests.id });
    await tx.insert(requestEvents).values({
      requestId: row!.id,
      actorId: actor.memberId,
      kind: 'submitted',
      data: actor.tokenName ? { via: actor.tokenName } : {},
      createdAt: now,
    });
    await writeAudit(tx as unknown as Db, {
      actor: { type: actor.tokenName ? 'token' : 'member', id: actor.memberId },
      action: 'request.created',
      targetType: 'request',
      targetId: row!.id,
      after: {
        number,
        requestTypeId: input.type.id,
        ...(actor.tokenName ? { via: actor.tokenName } : {}),
      },
    });
    return row!.id;
  }

  private async insertSteps(
    tx: Tx,
    owner: { requestId: string } | { groupId: string },
    steps: Array<ApprovalStepInput & { origin: 'mandatory' | 'requester_added' }>,
  ): Promise<void> {
    if (steps.length === 0) return;
    await tx.insert(approvalSteps).values(
      steps.map((step, position) => ({
        ...owner,
        position,
        origin: step.origin,
        selector: step.selector,
        rule: step.rule,
      })),
    );
  }

  /** Instance-wide sequence; the upsert's row lock keeps numbers unique across replicas. */
  private async nextNumber(tx: Tx, name: 'request' | 'request_group'): Promise<number> {
    const [row] = await tx
      .insert(counters)
      .values({ name, value: 1 })
      .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
      .returning({ value: counters.value });
    return row!.value;
  }

  /** The requester's home department, else the department of their first team. */
  private async requesterDepartment(tx: Tx, memberId: string): Promise<string | null> {
    const [member] = await tx
      .select({ home: members.homeDepartmentId })
      .from(members)
      .where(eq(members.id, memberId));
    if (member?.home) return member.home;
    const [team] = await tx
      .select({ departmentId: teams.departmentId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(eq(teamMemberships.memberId, memberId))
      .orderBy(asc(teams.name))
      .limit(1);
    return team?.departmentId ?? null;
  }

  private async setStatus(
    row: RequestRow,
    status: RequestStatus,
    actorId: string,
    kind: string = 'status_changed',
  ): Promise<void> {
    const now = this.now();
    await this.db
      .update(requests)
      .set({
        status,
        updatedAt: now,
        ...(status === 'resolved' ? { resolvedAt: now } : {}),
        ...(isFinalRequestStatus(status) ? { closedAt: now } : {}),
      })
      .where(eq(requests.id, row.id));
    await this.event(row.id, actorId, kind, { from: row.status, to: status });
    row.status = status;
  }

  private async event(
    requestId: string,
    actorId: string | null,
    kind: string,
    data: Record<string, unknown>,
  ) {
    await this.db
      .insert(requestEvents)
      .values({ requestId, actorId, kind, data, createdAt: this.now() });
  }

  private async addComment(requestId: string, authorId: string, body: string, internal: boolean) {
    const now = this.now();
    await this.db.insert(comments).values({
      subjectType: 'request',
      subjectId: requestId,
      authorId,
      body,
      visibility: internal ? 'internal' : 'public',
      createdAt: now,
      updatedAt: now,
    });
    await this.db.update(requests).set({ updatedAt: now }).where(eq(requests.id, requestId));
  }

  private async notifyRequester(
    row: RequestRow,
    kind:
      | 'request_rejected'
      | 'request_changes_requested'
      | 'approval_decided'
      | 'request_status_changed',
    actorId: string,
    data: Record<string, unknown>,
  ) {
    if (!row.requesterId || row.requesterId === actorId) return;
    await this.deps.notifier.notify({
      recipients: [row.requesterId],
      kind,
      actorId,
      subject: { type: 'request', id: row.id },
      data,
    });
  }

  /** Tells open pages of everyone involved, and the team's queue, that the request changed. */
  private async changed(requestId: string): Promise<void> {
    if (!this.deps.events) return;
    const row = await this.fresh(requestId);
    const owners: SQL[] = [eq(approvalSteps.requestId, row.id)];
    if (row.groupId) owners.push(eq(approvalSteps.groupId, row.groupId));
    const steps = await this.db
      .select({ ids: approvalSteps.resolvedApproverIds })
      .from(approvalSteps)
      .where(sql`(${sql.join(owners, sql` or `)})`);
    await this.deps.events.publish({
      type: 'request.changed',
      teamId: row.targetTeamId,
      identifier: formatRequestIdentifier(row.number),
      memberIds: [
        ...new Set(
          [row.requesterId, ...steps.flatMap((s) => s.ids)].filter((id): id is string =>
            Boolean(id),
          ),
        ),
      ],
    });
  }

  /** Request events in the target team's Slack channels; only public facts, no comments. */
  private toChannels(
    row: RequestRow,
    event: 'request_received' | 'approval_requested' | 'approval_decided' | 'request_resolved',
  ) {
    this.deps.channels?.publish(row.targetTeamId, event, {
      identifier: formatRequestIdentifier(row.number),
      title: row.title,
      path: `/requests/${formatRequestIdentifier(row.number)}`,
      context: [row.status],
    });
  }

  /** A request reached the team: its members hear about it. */
  private async notifyTeam(row: RequestRow, actorId: string) {
    this.toChannels(row, 'request_received');
    const people = await this.db
      .select({ id: teamMemberships.memberId })
      .from(teamMemberships)
      .where(eq(teamMemberships.teamId, row.targetTeamId));
    await this.deps.notifier.notify({
      recipients: people.map((p) => p.id).filter((id) => id !== row.requesterId),
      kind: 'request_received',
      actorId,
      subject: { type: 'request', id: row.id },
    });
  }

  private async decisionsSinceActivation(step: StepRow) {
    const rows = await this.db
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.stepId, step.id))
      .orderBy(asc(approvalDecisions.createdAt));
    return rows.filter((d) => !step.activatedAt || d.createdAt >= step.activatedAt);
  }

  // -------------------------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------------------------

  private async perspective(memberId: string, row: RequestRow): Promise<Perspective> {
    const isRequester = row.requesterId === memberId;
    const [team] = await this.db.select().from(teams).where(eq(teams.id, row.targetTeamId));
    const teamCan = await this.deps.teamAccess.forTeam(memberId, team!);
    const teamScope: Scope = { type: 'team', id: row.targetTeamId };
    const isAgent =
      teamCan.read ||
      (await this.has(memberId, 'request.read_department', {
        type: 'department',
        id: row.targetDepartmentId,
      })) ||
      (await this.has(memberId, 'org.manage', ORGANIZATION_SCOPE));
    const isApprover = await this.isApproverOf(memberId, row);
    const final = isFinalRequestStatus(row.status);
    const triage = await this.has(memberId, 'request.triage', teamScope);
    return {
      isRequester,
      isAgent,
      isApprover,
      can: {
        act:
          isAgent &&
          triage &&
          !final &&
          row.status !== 'pending_approval' &&
          row.status !== 'changes_requested',
        commentPublic: !final && (isRequester || isApprover || (isAgent && teamCan.comment)),
        commentInternal:
          !final && isAgent && (await this.has(memberId, 'request.comment_internal', teamScope)),
        resubmit: isRequester && row.status === 'changes_requested',
        confirm: isRequester && row.status === 'resolved',
        spawnIssue: isAgent && teamCan.create && !final,
      },
    };
  }

  private async canSee(memberId: string, row: RequestRow): Promise<boolean> {
    const p = await this.perspective(memberId, row);
    return p.isRequester || p.isAgent || p.isApprover;
  }

  private async canSeeStep(memberId: string, step: StepRow): Promise<boolean> {
    if (step.requestId) return this.canSee(memberId, await this.fresh(step.requestId));
    const [group] = await this.db
      .select()
      .from(requestGroups)
      .where(eq(requestGroups.id, step.groupId!));
    return group?.requesterId === memberId;
  }

  private async isApproverOf(memberId: string, row: RequestRow): Promise<boolean> {
    const owners: SQL[] = [eq(approvalSteps.requestId, row.id)];
    if (row.groupId) owners.push(eq(approvalSteps.groupId, row.groupId));
    const steps = await this.db
      .select({ ids: approvalSteps.resolvedApproverIds })
      .from(approvalSteps)
      .where(sql`(${sql.join(owners, sql` or `)})`);
    return steps.some((s) => s.ids.includes(memberId));
  }

  private async has(memberId: string, permission: Permission, scope: Scope): Promise<boolean> {
    const loaded = await this.deps.access.load(memberId);
    return can(loaded.assignments, loaded.rolePermissions, permission, scope, loaded.directory);
  }

  private async assertCanRequest(memberId: string): Promise<void> {
    const loaded = await this.deps.access.load(memberId);
    const allowed = loaded.assignments.some((a) =>
      (loaded.rolePermissions(a.roleId) ?? []).includes('request.create'),
    );
    if (!allowed) throw new DomainError('forbidden');
  }

  private async assertTeamMember(teamId: string, memberId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: teamMemberships.memberId })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.memberId, memberId)));
    if (!row) throw new DomainError('assignee_not_in_team');
  }

  private async activeType(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [type] = await this.db.select().from(requestTypes).where(eq(requestTypes.id, id));
    if (!type) throw new DomainError('not_found');
    if (type.archivedAt) throw new DomainError('request_type_archived');
    return type;
  }

  private validForm(fields: FormField[], data: Record<string, unknown>): RequestFormData {
    const result = validateFormData(fields, data);
    if (!result.ok) throw new DomainError('form_invalid');
    return result.data;
  }

  private async byIdentifier(identifier: string): Promise<RequestRow> {
    const number = parseRequestIdentifier(identifier);
    if (!number) throw new DomainError('not_found');
    const [row] = await this.db.select().from(requests).where(eq(requests.number, number));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async fresh(id: string): Promise<RequestRow> {
    const [row] = await this.db.select().from(requests).where(eq(requests.id, id));
    return row!;
  }

  // -------------------------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------------------------

  private async summaries(where: SQL | undefined, newestFirst = false): Promise<RequestSummary[]> {
    const rows = await this.db
      .select({
        request: requests,
        typeName: requestTypes.name,
        departmentName: departments.name,
        team: { id: teams.id, key: teams.key, name: teams.name },
        requesterName: requester.name,
        assigneeName: assignee.name,
        groupNumber: requestGroups.number,
      })
      .from(requests)
      .innerJoin(requestTypes, eq(requestTypes.id, requests.requestTypeId))
      .innerJoin(departments, eq(departments.id, requests.targetDepartmentId))
      .innerJoin(teams, eq(teams.id, requests.targetTeamId))
      .leftJoin(requester, eq(requester.id, requests.requesterId))
      .leftJoin(assignee, eq(assignee.id, requests.assigneeId))
      .leftJoin(requestGroups, eq(requestGroups.id, requests.groupId))
      .where(where)
      .orderBy(newestFirst ? desc(requests.number) : asc(requests.number));
    return rows.map((r) => ({
      id: r.request.id,
      identifier: formatRequestIdentifier(r.request.number),
      title: r.request.title,
      status: r.request.status,
      priority: r.request.priority,
      requestType: { id: r.request.requestTypeId, name: r.typeName },
      department: { id: r.request.targetDepartmentId, name: r.departmentName },
      targetTeam: r.team,
      requester: r.request.requesterId
        ? { id: r.request.requesterId, name: r.requesterName ?? '' }
        : null,
      assignee: r.request.assigneeId
        ? { id: r.request.assigneeId, name: r.assigneeName ?? '' }
        : null,
      group:
        r.request.groupId && r.groupNumber
          ? { id: r.request.groupId, identifier: formatGroupIdentifier(r.groupNumber) }
          : null,
      createdAt: r.request.createdAt.toISOString(),
      updatedAt: r.request.updatedAt.toISOString(),
    }));
  }

  private async stepViews(
    memberId: string,
    where: SQL,
    level: 'request' | 'group',
    requesterId: string | null,
  ): Promise<ApprovalStepView[]> {
    const steps = await this.db
      .select()
      .from(approvalSteps)
      .where(where)
      .orderBy(asc(approvalSteps.position));
    return Promise.all(
      steps.map(async (step) => {
        const approverIds = step.resolvedApproverIds;
        const people = approverIds.length
          ? await this.db
              .select({ id: members.id, name: members.name })
              .from(members)
              .where(inArray(members.id, approverIds))
          : [];
        const decisions = await this.db
          .select({ decision: approvalDecisions, name: members.name })
          .from(approvalDecisions)
          .leftJoin(members, eq(members.id, approvalDecisions.approverId))
          .where(eq(approvalDecisions.stepId, step.id))
          .orderBy(asc(approvalDecisions.createdAt));
        const current = await this.decisionsSinceActivation(step);
        return {
          id: step.id,
          position: step.position,
          origin: step.origin,
          level,
          selector: step.selector as ApproverSelector,
          names: await selectorNames(this.db, step.selector as ApproverSelector),
          rule: step.rule,
          status: step.status,
          approvers: people,
          decisions: decisions.map(({ decision, name }) => ({
            id: decision.id,
            approver: { id: decision.approverId, name: name ?? '' },
            decision: decision.decision,
            comment: decision.comment,
            createdAt: decision.createdAt.toISOString(),
          })),
          canDecide:
            step.status === 'active' &&
            approverIds.includes(memberId) &&
            memberId !== requesterId &&
            !current.some((d) => d.approverId === memberId),
        };
      }),
    );
  }

  async view(memberId: string, requestId: string): Promise<RequestView> {
    const row = await this.fresh(requestId);
    const [summary] = await this.summaries(eq(requests.id, requestId));
    const perspective = await this.perspective(memberId, row);
    const agent = perspective.isAgent;
    const [type] = await this.db
      .select()
      .from(requestTypes)
      .where(eq(requestTypes.id, row.requestTypeId));

    const thread = await this.db
      .select({ comment: comments, name: members.name })
      .from(comments)
      .leftJoin(members, eq(members.id, comments.authorId))
      .where(
        and(
          eq(comments.subjectType, 'request'),
          eq(comments.subjectId, requestId),
          isNull(comments.deletedAt),
          // Requesters and approvers never receive internal comments (CLAUDE.md invariant).
          ...(agent ? [] : [eq(comments.visibility, 'public')]),
        ),
      )
      .orderBy(asc(comments.createdAt));

    const events = await this.db
      .select({ event: requestEvents, name: members.name })
      .from(requestEvents)
      .leftJoin(members, eq(members.id, requestEvents.actorId))
      .where(eq(requestEvents.requestId, requestId))
      .orderBy(asc(requestEvents.createdAt), asc(requestEvents.id));

    const linked = await this.db
      .select({
        number: issues.number,
        title: issues.title,
        key: teams.key,
        category: workflowStatuses.category,
      })
      .from(issues)
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .innerJoin(workflowStatuses, eq(workflowStatuses.id, issues.statusId))
      .where(eq(issues.sourceRequestId, requestId))
      .orderBy(asc(issues.number));
    const done = (c: string) => c === 'completed' || c === 'canceled';

    const groupSteps = row.groupId
      ? await this.stepViews(
          memberId,
          eq(approvalSteps.groupId, row.groupId),
          'group',
          row.requesterId,
        )
      : [];
    const ownSteps = await this.stepViews(
      memberId,
      eq(approvalSteps.requestId, requestId),
      'request',
      row.requesterId,
    );
    const siblings = row.groupId
      ? (
          await this.summaries(
            and(eq(requests.groupId, row.groupId), sql`${requests.id} <> ${requestId}`),
          )
        ).map((s) => ({
          identifier: s.identifier,
          title: s.title,
          status: s.status,
          department: s.department,
        }))
      : [];

    return {
      ...summary!,
      description: row.description,
      fields: type!.fields as FormField[],
      formData: row.formData as RequestFormData,
      perspective: agent ? 'agent' : 'requester',
      approvals: [...groupSteps, ...ownSteps],
      comments: thread.map(({ comment, name }) => ({
        id: comment.id,
        author: comment.authorId ? { id: comment.authorId, name: name ?? '' } : null,
        body: comment.body,
        internal: comment.visibility === 'internal',
        createdAt: comment.createdAt.toISOString(),
      })),
      events: events
        // History of internal-only actions stays with the team.
        .filter(
          ({ event }) =>
            agent || !['issue_spawned', 'issue_linked', 'assigned'].includes(event.kind),
        )
        .map(({ event, name }) => ({
          id: event.id,
          kind: event.kind,
          actor: event.actorId ? { id: event.actorId, name: name ?? '' } : null,
          data: event.data as Record<string, unknown>,
          createdAt: event.createdAt.toISOString(),
        })),
      linkedIssues: agent
        ? {
            kind: 'details',
            items: linked.map((i) => ({
              identifier: formatIssueIdentifier(i.key, i.number),
              title: i.title,
              done: done(i.category),
            })),
          }
        : {
            kind: 'progress',
            done: linked.filter((i) => done(i.category)).length,
            total: linked.length,
          },
      siblings,
      can: perspective.can,
    };
  }

  async groupView(memberId: string, groupId: string): Promise<RequestGroupView> {
    const [group] = await this.db.select().from(requestGroups).where(eq(requestGroups.id, groupId));
    if (!group) throw new DomainError('not_found');
    const childRows = await this.db.select().from(requests).where(eq(requests.groupId, groupId));
    const visible =
      group.requesterId === memberId ||
      (
        await this.db
          .select({ ids: approvalSteps.resolvedApproverIds })
          .from(approvalSteps)
          .where(eq(approvalSteps.groupId, groupId))
      ).some((s) => s.ids.includes(memberId)) ||
      (await Promise.all(childRows.map((c) => this.canSee(memberId, c)))).some(Boolean);
    if (!visible) throw new DomainError('not_found');

    const approvals = await this.stepViews(
      memberId,
      eq(approvalSteps.groupId, groupId),
      'group',
      group.requesterId,
    );
    const children = await this.summaries(eq(requests.groupId, groupId));
    const statuses = children.map((c) => c.status);
    const status: RequestGroupView['status'] = approvals.some((s) => s.status === 'rejected')
      ? 'rejected'
      : approvals.some((s) => s.status === 'active' || s.status === 'waiting')
        ? 'pending_approval'
        : statuses.every((s) => ['resolved', 'closed', 'declined', 'rejected'].includes(s))
          ? 'resolved'
          : 'in_progress';
    return {
      id: group.id,
      identifier: formatGroupIdentifier(group.number),
      title: group.title,
      status,
      approvals,
      children,
    };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** What the approver saw; stored with each decision (SPEC §6.3). */
export function snapshotHash(row: {
  title: string;
  description: string;
  formData: unknown;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ title: row.title, description: row.description, formData: row.formData }),
    )
    .digest('hex');
}
