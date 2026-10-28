import {
  calendarInputSchema,
  can,
  formatRequestIdentifier,
  slaPolicyInputSchema,
  timeToMinutes,
  type CalendarView,
  type RequestSlaView,
  type RequestStatus,
  type SlaBadge,
  type SlaPolicyView,
  type SlaTargets,
} from '@ordler/shared';
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import {
  businessCalendars,
  comments,
  requestEvents,
  requests,
  requestTypes,
  slaPolicies,
  teamMemberships,
} from '../db/schema.js';
import type { TeamChannels } from '../issues/issue.service.js';
import type { Notifier } from '../notifications/notifier.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';
import type { WebhookEmitter } from '../webhooks/webhook.service.js';
import type { BusinessCalendar } from './business-time.js';
import { computeSla, slaBadge } from './clock.js';

type CalendarRow = typeof businessCalendars.$inferSelect;
type PolicyRow = typeof slaPolicies.$inferSelect;
type RequestRow = typeof requests.$inferSelect;

/** Requests whose clocks no longer matter for alerts. */
const CLOSED: RequestStatus[] = ['closed', 'declined', 'rejected', 'resolved'];

function toCalendar(row: CalendarRow): BusinessCalendar {
  return {
    timezone: row.timezone,
    hours: (row.hours as CalendarView['hours']).map((h) => ({
      day: h.day,
      start: timeToMinutes(h.start),
      end: timeToMinutes(h.end),
    })),
    holidays: row.holidays as string[],
  };
}

/**
 * SLA (SPEC §6.5): department calendars and policies (`sla_policy.manage` on the department),
 * the two clocks of every request, and at-risk and breach alerts from the worker.
 */
export class SlaService {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly deps: {
      db: Db;
      access: AccessContextSource;
      notifier: Notifier;
      hooks?: WebhookEmitter;
      channels?: TeamChannels;
      now?: () => Date;
      log?: (message: string) => void;
    },
  ) {}

  private get db(): Db {
    return this.deps.db;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  // -------------------------------------------------------------------------------------------
  // Calendars and policies
  // -------------------------------------------------------------------------------------------

  async calendars(memberId: string, departmentId: string): Promise<CalendarView[]> {
    await this.assertManager(memberId, departmentId);
    const rows = await this.db
      .select()
      .from(businessCalendars)
      .where(
        and(eq(businessCalendars.departmentId, departmentId), isNull(businessCalendars.archivedAt)),
      )
      .orderBy(asc(businessCalendars.name));
    return rows.map((row) => this.calendarView(row));
  }

  async createCalendar(
    memberId: string,
    departmentId: string,
    input: z.output<typeof calendarInputSchema>,
  ): Promise<CalendarView> {
    await this.assertManager(memberId, departmentId);
    const [row] = await this.db
      .insert(businessCalendars)
      .values({ departmentId, ...input })
      .returning();
    await this.audit(memberId, 'calendar.created', 'business_calendar', row!.id, input);
    return this.calendarView(row!);
  }

  async updateCalendar(
    memberId: string,
    id: string,
    input: z.output<typeof calendarInputSchema>,
  ): Promise<CalendarView> {
    const before = await this.calendarRow(id);
    await this.assertManager(memberId, before.departmentId);
    const [row] = await this.db
      .update(businessCalendars)
      .set(input)
      .where(eq(businessCalendars.id, id))
      .returning();
    await this.audit(memberId, 'calendar.updated', 'business_calendar', id, input, before);
    return this.calendarView(row!);
  }

  /** A calendar still used by a policy stays: clocks must not silently switch to 24/7. */
  async archiveCalendar(memberId: string, id: string): Promise<void> {
    const before = await this.calendarRow(id);
    await this.assertManager(memberId, before.departmentId);
    const [used] = await this.db
      .select({ id: slaPolicies.id })
      .from(slaPolicies)
      .where(and(eq(slaPolicies.calendarId, id), isNull(slaPolicies.archivedAt)));
    if (used) throw new DomainError('calendar_in_use');
    await this.db
      .update(businessCalendars)
      .set({ archivedAt: this.now() })
      .where(eq(businessCalendars.id, id));
    await this.audit(memberId, 'calendar.archived', 'business_calendar', id, {});
  }

  async policies(memberId: string, departmentId: string): Promise<SlaPolicyView[]> {
    await this.assertManager(memberId, departmentId);
    const rows = await this.db
      .select()
      .from(slaPolicies)
      .where(and(eq(slaPolicies.departmentId, departmentId), isNull(slaPolicies.archivedAt)))
      .orderBy(asc(slaPolicies.name));
    return this.policyViews(rows);
  }

  async createPolicy(
    memberId: string,
    departmentId: string,
    input: z.output<typeof slaPolicyInputSchema>,
  ): Promise<SlaPolicyView> {
    await this.assertManager(memberId, departmentId);
    await this.assertCalendar(departmentId, input.calendarId);
    const [row] = await this.db
      .insert(slaPolicies)
      .values({ departmentId, ...input })
      .returning();
    await this.audit(memberId, 'sla_policy.created', 'sla_policy', row!.id, input);
    return (await this.policyViews([row!]))[0]!;
  }

  async updatePolicy(
    memberId: string,
    id: string,
    input: z.output<typeof slaPolicyInputSchema>,
  ): Promise<SlaPolicyView> {
    const before = await this.policyRow(id);
    await this.assertManager(memberId, before.departmentId);
    await this.assertCalendar(before.departmentId, input.calendarId);
    const [row] = await this.db
      .update(slaPolicies)
      .set(input)
      .where(eq(slaPolicies.id, id))
      .returning();
    await this.audit(memberId, 'sla_policy.updated', 'sla_policy', id, input, before);
    return (await this.policyViews([row!]))[0]!;
  }

  /** Archived policies stop applying to new requests; running clocks keep their policy. */
  async archivePolicy(memberId: string, id: string): Promise<void> {
    const before = await this.policyRow(id);
    await this.assertManager(memberId, before.departmentId);
    await this.db.update(slaPolicies).set({ archivedAt: this.now() }).where(eq(slaPolicies.id, id));
    await this.db
      .update(requestTypes)
      .set({ slaPolicyId: null })
      .where(eq(requestTypes.slaPolicyId, id));
    await this.audit(memberId, 'sla_policy.archived', 'sla_policy', id, {});
  }

  /** For request types: the policy must belong to the department and be live. */
  async assertUsable(departmentId: string, policyId: string | null): Promise<void> {
    if (!policyId) return;
    const [row] = await this.db.select().from(slaPolicies).where(eq(slaPolicies.id, policyId));
    if (!row || row.departmentId !== departmentId || row.archivedAt) {
      throw new DomainError('validation_failed');
    }
  }

  /** Business hours of a request type's SLA policy; approval timeouts count in them too. */
  async calendarForType(requestTypeId: string): Promise<BusinessCalendar | null> {
    const [row] = await this.db
      .select({ calendar: businessCalendars })
      .from(requestTypes)
      .innerJoin(slaPolicies, eq(slaPolicies.id, requestTypes.slaPolicyId))
      .innerJoin(businessCalendars, eq(businessCalendars.id, slaPolicies.calendarId))
      .where(eq(requestTypes.id, requestTypeId));
    return row ? toCalendar(row.calendar) : null;
  }

  async policyRef(policyId: string | null): Promise<{ id: string; name: string } | null> {
    if (!policyId) return null;
    const [row] = await this.db
      .select({ id: slaPolicies.id, name: slaPolicies.name })
      .from(slaPolicies)
      .where(eq(slaPolicies.id, policyId));
    return row ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // Clocks
  // -------------------------------------------------------------------------------------------

  /** Both clocks of one request, or null when its type has no SLA. */
  async forRequest(row: RequestRow): Promise<RequestSlaView | null> {
    return (await this.forRequests([row])).get(row.id) ?? null;
  }

  /** Queue badges for many requests at once. */
  async badges(rows: RequestRow[]): Promise<Map<string, SlaBadge>> {
    const views = await this.forRequests(rows);
    const result = new Map<string, SlaBadge>();
    for (const [id, view] of views) {
      const badge = slaBadge(view);
      if (badge) result.set(id, badge);
    }
    return result;
  }

  private async forRequests(rows: RequestRow[]): Promise<Map<string, RequestSlaView>> {
    const withSla = rows.filter((r) => r.slaPolicyId);
    const result = new Map<string, RequestSlaView>();
    if (withSla.length === 0) return result;
    const ids = withSla.map((r) => r.id);
    const policyRows = await this.db
      .select()
      .from(slaPolicies)
      .where(inArray(slaPolicies.id, [...new Set(withSla.map((r) => r.slaPolicyId!))]));
    const calendarIds = policyRows.flatMap((p) => (p.calendarId ? [p.calendarId] : []));
    const calendarRows = calendarIds.length
      ? await this.db
          .select()
          .from(businessCalendars)
          .where(inArray(businessCalendars.id, calendarIds))
      : [];
    const statusEvents = await this.db
      .select({
        requestId: requestEvents.requestId,
        actorId: requestEvents.actorId,
        data: requestEvents.data,
        createdAt: requestEvents.createdAt,
      })
      .from(requestEvents)
      .where(
        and(
          inArray(requestEvents.requestId, ids), // Status changes are the events that carry both ends; assignments only carry `to`.
          sql`${requestEvents.data} ?& array['from', 'to']`,
        ),
      )
      .orderBy(asc(requestEvents.createdAt));
    const replies = await this.db
      .select({
        subjectId: comments.subjectId,
        authorId: comments.authorId,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(
        and(
          eq(comments.subjectType, 'request'),
          inArray(comments.subjectId, ids),
          eq(comments.visibility, 'public'),
        ),
      )
      .orderBy(asc(comments.createdAt));
    const now = this.now().getTime();
    for (const row of withSla) {
      const policy = policyRows.find((p) => p.id === row.slaPolicyId);
      if (!policy) continue;
      const calendarRow = calendarRows.find((c) => c.id === policy.calendarId);
      const changes = statusEvents.filter((e) => e.requestId === row.id);
      const first = changes[0]?.data as { from?: RequestStatus } | undefined;
      const timeline = [
        { at: row.createdAt.getTime(), status: first?.from ?? row.status },
        ...changes.map((e) => ({
          at: e.createdAt.getTime(),
          status: (e.data as { to: RequestStatus }).to,
        })),
      ];
      // The receiving team answers: a public reply or any status move by someone else.
      const byTeam = (actor: string | null) => actor !== null && actor !== row.requesterId;
      const reply = replies.find((c) => c.subjectId === row.id && byTeam(c.authorId));
      const moved = changes.find(
        (e) =>
          byTeam(e.actorId) &&
          !['pending_approval', 'changes_requested', 'open'].includes(
            (e.data as { to: string }).to,
          ),
      );
      const responses = [reply?.createdAt.getTime(), moved?.createdAt.getTime()].filter(
        (v): v is number => v !== undefined,
      );
      const target = (policy.targets as SlaTargets)[row.priority];
      result.set(row.id, {
        policy: { id: policy.id, name: policy.name },
        ...computeSla({
          calendar: calendarRow ? toCalendar(calendarRow) : null,
          pauseDuringApproval: policy.pauseDuringApproval,
          firstResponseMinutes: target?.firstResponseMinutes ?? null,
          resolutionMinutes: target?.resolutionMinutes ?? null,
          timeline,
          firstResponseAt: responses.length ? Math.min(...responses) : null,
          now,
        }),
      });
    }
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------------------------

  startRunner(intervalMs = 60_000): void {
    const run = () =>
      void this.tick().catch((error: unknown) =>
        this.deps.log?.(`SLA check failed: ${String(error)}`),
      );
    run();
    this.timer = setInterval(run, intervalMs);
    this.timer.unref();
  }

  stopRunner(): void {
    clearInterval(this.timer);
  }

  /** Sends each at-risk and breach alert once per request and clock. */
  async tick(): Promise<number> {
    const open = await this.db
      .select()
      .from(requests)
      .where(and(isNotNull(requests.slaPolicyId), notInArray(requests.status, CLOSED)));
    let sent = 0;
    for (let i = 0; i < open.length; i += 200) {
      const batch = open.slice(i, i + 200);
      const views = await this.forRequests(batch);
      for (const row of batch) {
        const view = views.get(row.id);
        if (!view) continue;
        const alerts = { ...(row.slaAlerts as Record<string, string>) };
        const due: Array<{
          metric: 'firstResponse' | 'resolution';
          level: 'at_risk' | 'breached';
        }> = [];
        for (const metric of ['firstResponse', 'resolution'] as const) {
          const state = view[metric]?.state;
          // A breach implies the risk: never send "at risk" after the fact.
          if (state === 'breached' && !alerts[`${metric}:breached`])
            due.push({ metric, level: 'breached' });
          else if (state === 'at_risk' && !alerts[`${metric}:at_risk`])
            due.push({ metric, level: 'at_risk' });
        }
        if (due.length === 0) continue;
        const stamp = this.now().toISOString();
        for (const alert of due) {
          alerts[`${alert.metric}:${alert.level}`] = stamp;
          if (alert.level === 'breached') alerts[`${alert.metric}:at_risk`] ??= stamp;
        }
        // Claim first, so two workers never send the same alert twice.
        const claimed = await this.db
          .update(requests)
          .set({ slaAlerts: alerts })
          .where(
            and(
              eq(requests.id, row.id),
              sql`${requests.slaAlerts} = ${JSON.stringify(row.slaAlerts)}::jsonb`,
            ),
          )
          .returning({ id: requests.id });
        if (claimed.length === 0) continue;
        for (const alert of due) {
          await this.alert(row, alert.metric, alert.level, view);
          sent++;
        }
      }
    }
    return sent;
  }

  private async alert(
    row: RequestRow,
    metric: 'firstResponse' | 'resolution',
    level: 'at_risk' | 'breached',
    view: RequestSlaView,
  ): Promise<void> {
    const recipients = row.assigneeId
      ? [row.assigneeId]
      : (
          await this.db
            .select({ id: teamMemberships.memberId })
            .from(teamMemberships)
            .where(eq(teamMemberships.teamId, row.targetTeamId))
        ).map((m) => m.id);
    await this.deps.notifier.notify({
      recipients,
      kind: level === 'breached' ? 'sla_breached' : 'sla_at_risk',
      actorId: null,
      subject: { type: 'request', id: row.id },
      data: { metric, dueAt: view[metric]?.dueAt ?? null },
    });
    const identifier = formatRequestIdentifier(row.number);
    this.deps.channels?.publish(
      row.targetTeamId,
      level === 'breached' ? 'sla_breached' : 'sla_at_risk',
      {
        identifier,
        title: row.title,
        path: `/requests/${identifier}`,
        context: [metric === 'firstResponse' ? 'first response' : 'resolution'],
      },
    );
    await this.deps.hooks?.requestEvent(
      level === 'breached' ? 'sla.breached' : 'sla.at_risk',
      row,
      null,
      {
        sla: { metric, ...view[metric] },
      },
    );
  }

  // -------------------------------------------------------------------------------------------

  private calendarView(row: CalendarRow): CalendarView {
    return {
      id: row.id,
      departmentId: row.departmentId,
      name: row.name,
      timezone: row.timezone,
      hours: row.hours as CalendarView['hours'],
      holidays: row.holidays as string[],
    };
  }

  private async policyViews(rows: PolicyRow[]): Promise<SlaPolicyView[]> {
    const ids = rows.flatMap((r) => (r.calendarId ? [r.calendarId] : []));
    const calendars = ids.length
      ? await this.db
          .select({ id: businessCalendars.id, name: businessCalendars.name })
          .from(businessCalendars)
          .where(inArray(businessCalendars.id, ids))
      : [];
    return rows.map((row) => ({
      id: row.id,
      departmentId: row.departmentId,
      name: row.name,
      calendar: calendars.find((c) => c.id === row.calendarId) ?? null,
      pauseDuringApproval: row.pauseDuringApproval,
      targets: row.targets as SlaTargets,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }

  private async assertCalendar(departmentId: string, calendarId: string | null): Promise<void> {
    if (!calendarId) return;
    const row = await this.calendarRow(calendarId).catch(() => undefined);
    if (!row || row.departmentId !== departmentId || row.archivedAt) {
      throw new DomainError('validation_failed');
    }
  }

  private async calendarRow(id: string): Promise<CalendarRow> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db
      .select()
      .from(businessCalendars)
      .where(eq(businessCalendars.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async policyRow(id: string): Promise<PolicyRow> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(slaPolicies).where(eq(slaPolicies.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async assertManager(memberId: string, departmentId: string): Promise<void> {
    const loaded = await this.deps.access.load(memberId);
    const allowed = can(
      loaded.assignments,
      loaded.rolePermissions,
      'sla_policy.manage',
      { type: 'department', id: departmentId },
      loaded.directory,
    );
    if (!allowed) throw new DomainError('forbidden');
  }

  private async audit(
    memberId: string,
    action: string,
    targetType: string,
    targetId: string,
    after: object,
    before?: object,
  ): Promise<void> {
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action,
      targetType,
      targetId,
      after,
      ...(before ? { before } : {}),
    });
  }
}
