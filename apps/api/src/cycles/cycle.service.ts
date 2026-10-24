import type {
  CycleDetail,
  CycleRef,
  CycleSettings,
  CycleView,
  IssueStatusCategory,
  TeamCycles,
} from '@ordler/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { cycles, issueEvents, issues, teams, workflows, workflowStatuses } from '../db/schema.js';
import type { IssueService } from '../issues/issue.service.js';
import type { TeamAccess } from '../issues/team-access.js';
import type { EventBus } from '../realtime/event-bus.js';
import {
  burnup,
  cycleEnd,
  cycleState,
  firstCycleStart,
  isoDate,
  nextCycleStart,
  type IssueTimeline,
} from './planning.js';

type TeamRow = typeof teams.$inferSelect;
type CycleRow = typeof cycles.$inferSelect;

/** Past cycles shown in the list; older ones stay reachable by link. */
const PAST_SHOWN = 3;
const DONE: readonly IssueStatusCategory[] = ['completed', 'canceled'];

export function settingsOf(team: TeamRow): CycleSettings {
  return {
    enabled: team.cyclesEnabled,
    weeks: team.cycleWeeks,
    startDay: team.cycleStartDay,
    cooldownWeeks: team.cycleCooldownWeeks,
    upcoming: team.cycleUpcoming,
  };
}

/**
 * Cycles (SPEC §5.2): each team plans fixed-length iterations ahead; when one ends its
 * unfinished issues roll over to the next. Planning is idempotent and serialised per team with
 * an advisory lock, so the scheduler on several replicas and page loads never double-create.
 */
export class CycleService {
  constructor(
    private readonly deps: {
      db: Db;
      access: TeamAccess;
      issues: IssueService;
      events: EventBus;
      now?: () => Date;
    },
  ) {}

  private get db(): Db {
    return this.deps.db;
  }

  private today(): string {
    return isoDate(this.deps.now?.() ?? new Date());
  }

  async list(memberId: string, key: string): Promise<TeamCycles> {
    const team = await this.readableTeam(memberId, key);
    await this.ensure(team);
    const rows = await this.db
      .select()
      .from(cycles)
      .where(eq(cycles.teamId, team.id))
      .orderBy(asc(cycles.startsOn));
    const today = this.today();
    const past = rows.filter((c) => cycleState(c, today) === 'past').slice(-PAST_SHOWN);
    const rest = rows.filter((c) => cycleState(c, today) !== 'past');
    return { settings: settingsOf(team), cycles: await this.views([...past, ...rest]) };
  }

  async get(memberId: string, cycleId: string): Promise<CycleDetail> {
    const cycle = await this.cycleRow(cycleId);
    const [team] = await this.db.select().from(teams).where(eq(teams.id, cycle.teamId));
    if (!team || !(await this.deps.access.forTeam(memberId, team)).read) {
      throw new DomainError('not_found');
    }
    const [view] = await this.views([cycle]);
    const list = (await this.deps.issues.list(memberId, team.key)).filter(
      (issue) => issue.cycleId === cycle.id,
    );
    const timelines = await this.timelines(cycle, team.id);
    const today = this.today();
    const lastDay = cycle.endsOn < today ? cycle.endsOn : today;
    const points =
      cycle.startsOn > today ? [] : burnup(cycle.id, cycle.startsOn, lastDay, timelines);
    const startOfCycle = `${cycle.startsOn}T00:00:00.000Z`;
    const addedAfterStart = timelines.filter((t) => {
      const added = t.cycle.find((c) => c.cycleId === cycle.id);
      return added !== undefined && added.at >= startOfCycle;
    }).length;
    return {
      ...view!,
      team: { id: team.id, key: team.key, name: team.name },
      issues: list,
      burnup: points,
      addedAfterStart,
    };
  }

  async updateSettings(memberId: string, key: string, input: CycleSettings): Promise<TeamCycles> {
    const team = await this.managedTeam(memberId, key);
    const before = settingsOf(team);
    await this.db
      .update(teams)
      .set({
        cyclesEnabled: input.enabled,
        cycleWeeks: input.weeks,
        cycleStartDay: input.startDay,
        cycleCooldownWeeks: input.cooldownWeeks,
        cycleUpcoming: input.upcoming,
      })
      .where(eq(teams.id, team.id));
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action: 'team.cycles_updated',
      targetType: 'team',
      targetId: team.id,
      before,
      after: input,
    });
    await this.deps.events.publish({ type: 'team.changed', teamId: team.id });
    return this.list(memberId, key);
  }

  async rename(memberId: string, cycleId: string, name: string | null): Promise<CycleView> {
    const cycle = await this.cycleRow(cycleId);
    const [team] = await this.db.select().from(teams).where(eq(teams.id, cycle.teamId));
    await this.managedTeam(memberId, team!.key);
    await this.db
      .update(cycles)
      .set({ name: name || null })
      .where(eq(cycles.id, cycle.id));
    await this.deps.events.publish({ type: 'team.changed', teamId: cycle.teamId });
    const [view] = await this.views([await this.cycleRow(cycleId)]);
    return view!;
  }

  private timer: NodeJS.Timeout | undefined;

  /** Background planning on worker replicas; page loads also plan lazily, so a gap is harmless. */
  start(intervalMs = 10 * 60_000, log?: (message: string) => void): void {
    const run = () =>
      void this.tick().catch((error: unknown) => log?.(`Cycle planning failed: ${String(error)}`));
    run();
    this.timer = setInterval(run, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Scheduler entry point: plans and rolls over every team that uses cycles. */
  async tick(): Promise<void> {
    const enabled = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.cyclesEnabled, true), isNull(teams.archivedAt)));
    for (const team of enabled) await this.ensure(team);
  }

  /** Current and upcoming cycles of a team, for issue pickers. */
  async openCycles(teamId: string): Promise<CycleRef[]> {
    const rows = await this.db
      .select()
      .from(cycles)
      .where(and(eq(cycles.teamId, teamId), sql`${cycles.endsOn} >= ${this.today()}`))
      .orderBy(asc(cycles.startsOn));
    const today = this.today();
    return rows.map((c) => this.ref(c, today));
  }

  /** Plans cycles ahead and rolls over ended ones; safe to call from anywhere, any time. */
  async ensure(team: TeamRow): Promise<void> {
    if (!team.cyclesEnabled) return;
    const today = this.today();
    let changed = false;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cycles:${team.id}`}))`);
      const db = tx as unknown as Db;
      changed = (await this.plan(db, team, today)) || changed;
      changed = (await this.rollOver(db, team, today)) || changed;
    });
    if (changed) await this.deps.events.publish({ type: 'team.changed', teamId: team.id });
  }

  private async plan(db: Db, team: TeamRow, today: string): Promise<boolean> {
    const [last] = await db
      .select()
      .from(cycles)
      .where(eq(cycles.teamId, team.id))
      .orderBy(desc(cycles.number))
      .limit(1);
    let number = last?.number ?? 0;
    let start = last
      ? nextCycleStart(last.endsOn, team.cycleCooldownWeeks)
      : firstCycleStart(today, team.cycleStartDay);
    // After a long pause, skip the periods nobody planned instead of filling the past.
    while (cycleEnd(start, team.cycleWeeks) < today) {
      start = nextCycleStart(cycleEnd(start, team.cycleWeeks), team.cycleCooldownWeeks);
    }
    const [{ future } = { future: 0 }] = await db
      .select({ future: sql<number>`count(*)::int` })
      .from(cycles)
      .where(and(eq(cycles.teamId, team.id), gt(cycles.startsOn, today)));
    let ahead = future;
    let created = false;
    // A current cycle (if today is not a cooldown day) plus `upcoming` future ones.
    const hasCurrent = last ? cycleState(last, today) === 'current' : false;
    let needCurrent = !hasCurrent && start <= today;
    while (needCurrent || ahead < team.cycleUpcoming) {
      number += 1;
      const endsOn = cycleEnd(start, team.cycleWeeks);
      await db.insert(cycles).values({ teamId: team.id, number, startsOn: start, endsOn });
      if (start > today) ahead += 1;
      needCurrent = false;
      created = true;
      start = nextCycleStart(endsOn, team.cycleCooldownWeeks);
    }
    return created;
  }

  /** Moves unfinished issues of ended cycles into the next one, recording it in history. */
  private async rollOver(db: Db, team: TeamRow, today: string): Promise<boolean> {
    const ended = await db
      .select()
      .from(cycles)
      .where(and(eq(cycles.teamId, team.id), lt(cycles.endsOn, today), isNull(cycles.closedAt)))
      .orderBy(asc(cycles.startsOn));
    if (ended.length === 0) return false;
    const categories = await this.categories(db, team.id);
    for (const cycle of ended) {
      const [next] = await db
        .select()
        .from(cycles)
        .where(and(eq(cycles.teamId, team.id), gt(cycles.startsOn, cycle.endsOn)))
        .orderBy(asc(cycles.startsOn))
        .limit(1);
      const open = (
        await db
          .select({ id: issues.id, statusId: issues.statusId })
          .from(issues)
          .where(and(eq(issues.cycleId, cycle.id), isNull(issues.archivedAt)))
      ).filter((issue) => !DONE.includes(categories.get(issue.statusId) ?? 'unstarted'));
      const to = next?.id ?? null;
      if (open.length > 0) {
        const now = this.deps.now?.() ?? new Date();
        await db
          .update(issues)
          .set({ cycleId: to, updatedAt: now })
          .where(
            inArray(
              issues.id,
              open.map((issue) => issue.id),
            ),
          );
        await db.insert(issueEvents).values(
          open.map((issue) => ({
            issueId: issue.id,
            actorId: null,
            kind: 'updated' as const,
            changes: { cycleId: { from: cycle.id, to } },
            createdAt: now,
          })),
        );
      }
      await db
        .update(cycles)
        .set({ closedAt: this.deps.now?.() ?? new Date() })
        .where(eq(cycles.id, cycle.id));
    }
    return true;
  }

  /** Every status of the team's workflow, archived ones too, since history refers to them. */
  private async categories(db: Db, teamId: string): Promise<Map<string, IssueStatusCategory>> {
    const rows = await db
      .select({ id: workflowStatuses.id, category: workflowStatuses.category })
      .from(workflowStatuses)
      .innerJoin(workflows, eq(workflows.id, workflowStatuses.workflowId))
      .where(and(eq(workflows.ownerType, 'team'), eq(workflows.ownerId, teamId)));
    return new Map(rows.map((r) => [r.id, r.category]));
  }

  /** Cycle membership and status history of every issue that was ever in the cycle. */
  private async timelines(cycle: CycleRow, teamId: string): Promise<IssueTimeline[]> {
    const categories = await this.categories(this.db, teamId);
    const events = await this.db
      .select({
        issueId: issueEvents.issueId,
        kind: issueEvents.kind,
        changes: issueEvents.changes,
        at: issueEvents.createdAt,
        statusId: issues.statusId,
        cycleId: issues.cycleId,
      })
      .from(issueEvents)
      .innerJoin(issues, eq(issues.id, issueEvents.issueId))
      .where(and(eq(issues.teamId, teamId), isNull(issues.archivedAt)))
      .orderBy(asc(issueEvents.createdAt), asc(issueEvents.id));
    const byIssue = new Map<string, typeof events>();
    for (const event of events) {
      byIssue.set(event.issueId, [...(byIssue.get(event.issueId) ?? []), event]);
    }
    const timelines: IssueTimeline[] = [];
    for (const list of byIssue.values()) {
      type Change = { from: unknown; to: unknown };
      const changes = list.map((e) => ({
        ...e,
        c: e.changes as Record<string, Change | undefined>,
      }));
      const cycleChanges = changes.filter((e) => e.c.cycleId);
      const statusChanges = changes.filter((e) => e.c.statusId);
      if (
        !list.some((e) => e.cycleId === cycle.id) &&
        !cycleChanges.some((e) => e.c.cycleId!.to === cycle.id || e.c.cycleId!.from === cycle.id)
      ) {
        continue;
      }
      const created = list[0]!;
      const createdAt = created.at.toISOString();
      // Values at creation: the first recorded change's "from", or today's value if unchanged.
      const initialCycle =
        (cycleChanges[0]?.c.cycleId?.from as string | null | undefined) ??
        (cycleChanges.length === 0 ? created.cycleId : null);
      const initialStatus =
        (statusChanges[0]?.c.statusId?.from as string | undefined) ?? created.statusId;
      timelines.push({
        cycle: [
          { at: createdAt, cycleId: initialCycle },
          ...cycleChanges.map((e) => ({
            at: e.at.toISOString(),
            cycleId: (e.c.cycleId!.to as string | null) ?? null,
          })),
        ],
        status: [
          { at: createdAt, category: categories.get(initialStatus) ?? 'unstarted' },
          ...statusChanges.map((e) => ({
            at: e.at.toISOString(),
            category: categories.get(e.c.statusId!.to as string) ?? 'unstarted',
          })),
        ],
      });
    }
    return timelines;
  }

  private async views(rows: CycleRow[]): Promise<CycleView[]> {
    if (rows.length === 0) return [];
    const today = this.today();
    const teamIds = [...new Set(rows.map((r) => r.teamId))];
    const categories = new Map<string, IssueStatusCategory>();
    for (const teamId of teamIds) {
      for (const [id, category] of await this.categories(this.db, teamId))
        categories.set(id, category);
    }
    const members = await this.db
      .select({ cycleId: issues.cycleId, statusId: issues.statusId })
      .from(issues)
      .where(
        and(
          inArray(
            issues.cycleId,
            rows.map((r) => r.id),
          ),
          isNull(issues.archivedAt),
        ),
      );
    return rows.map((row) => {
      const inCycle = members.filter((m) => m.cycleId === row.id);
      const category = (statusId: string) => categories.get(statusId) ?? 'unstarted';
      return {
        ...this.ref(row, today),
        progress: {
          total: inCycle.filter((m) => category(m.statusId) !== 'canceled').length,
          started: inCycle.filter((m) => category(m.statusId) === 'started').length,
          completed: inCycle.filter((m) => category(m.statusId) === 'completed').length,
        },
      };
    });
  }

  private ref(row: CycleRow, today: string): CycleRef {
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      state: cycleState(row, today),
    };
  }

  private async cycleRow(id: string): Promise<CycleRow> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(cycles).where(eq(cycles.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async readableTeam(memberId: string, key: string): Promise<TeamRow> {
    const [team] = await this.db.select().from(teams).where(eq(teams.key, key.toUpperCase()));
    if (!team || team.archivedAt || !(await this.deps.access.forTeam(memberId, team)).read) {
      throw new DomainError('not_found');
    }
    return team;
  }

  private async managedTeam(memberId: string, key: string): Promise<TeamRow> {
    const team = await this.readableTeam(memberId, key);
    if (!(await this.deps.access.forTeam(memberId, team)).manage)
      throw new DomainError('forbidden');
    return team;
  }
}
