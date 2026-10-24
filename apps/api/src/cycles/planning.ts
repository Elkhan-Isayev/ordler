import type { BurnupPoint, CycleState, IssueStatusCategory } from '@ordler/shared';

/** Calendar dates as `YYYY-MM-DD`, computed in UTC so every replica agrees. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
function weekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The latest day on or before `today` that falls on the team's start weekday. */
export function firstCycleStart(today: string, startDay: number): string {
  return addDays(today, -((weekday(today) - startDay + 7) % 7));
}

export function cycleEnd(startsOn: string, weeks: number): string {
  return addDays(startsOn, weeks * 7 - 1);
}

/** The next cycle starts the day after the previous one ends, plus the cooldown. */
export function nextCycleStart(previousEndsOn: string, cooldownWeeks: number): string {
  return addDays(previousEndsOn, 1 + cooldownWeeks * 7);
}

export function cycleState(cycle: { startsOn: string; endsOn: string }, today: string): CycleState {
  if (cycle.endsOn < today) return 'past';
  if (cycle.startsOn > today) return 'upcoming';
  return 'current';
}

export interface IssueTimeline {
  /** Cycle membership changes in time order: the cycle the issue was in from `at` on. */
  cycle: Array<{ at: string; cycleId: string | null }>;
  /** Status category changes in time order. */
  status: Array<{ at: string; category: IssueStatusCategory }>;
}

function stateAt<T>(changes: Array<{ at: string } & T>, endOfDay: string): T | undefined {
  let current: T | undefined;
  for (const change of changes) {
    if (change.at > endOfDay) break;
    current = change;
  }
  return current;
}

/**
 * Burn-up from history: for each day, how many issues were in the cycle at the end of it, and
 * how many of those were completed. Scope rises when issues are added mid-cycle.
 */
export function burnup(
  cycleId: string,
  startsOn: string,
  lastDay: string,
  timelines: IssueTimeline[],
): BurnupPoint[] {
  const points: BurnupPoint[] = [];
  for (let date = startsOn; date <= lastDay; date = addDays(date, 1)) {
    const endOfDay = `${date}T23:59:59.999Z`;
    let scope = 0;
    let completed = 0;
    for (const timeline of timelines) {
      if (stateAt(timeline.cycle, endOfDay)?.cycleId !== cycleId) continue;
      scope += 1;
      if (stateAt(timeline.status, endOfDay)?.category === 'completed') completed += 1;
    }
    points.push({ date, scope, completed });
  }
  return points;
}
