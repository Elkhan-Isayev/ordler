import type {
  RequestSlaView,
  RequestStatus,
  SlaBadge,
  SlaMetricView,
  SlaState,
} from '@ordler/shared';
import { addBusinessMs, businessMs, type BusinessCalendar } from './business-time.js';

const MINUTE = 60_000;
/** SPEC §6.5: at risk from 75 % of the target. */
export const AT_RISK_SHARE = 0.75;

/** Statuses that end the resolution clock; reopening starts it again. */
const DONE: ReadonlySet<RequestStatus> = new Set(['resolved', 'closed', 'declined', 'rejected']);

export interface ClockInput {
  calendar: BusinessCalendar | null;
  pauseDuringApproval: boolean;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  /** Status from each moment on, oldest first; the first entry is the submission. */
  timeline: Array<{ at: number; status: RequestStatus }>;
  /** First reply or action by the receiving team. */
  firstResponseAt: number | null;
  now: number;
}

function paused(status: RequestStatus, pauseDuringApproval: boolean): boolean {
  if (status === 'waiting_for_requester') return true;
  return pauseDuringApproval && (status === 'pending_approval' || status === 'changes_requested');
}

/** Business time the clock ran between the submission and `until`. */
function running(input: ClockInput, until: number): number {
  let total = 0;
  for (const [i, entry] of input.timeline.entries()) {
    if (entry.at >= until) break;
    if (paused(entry.status, input.pauseDuringApproval) || DONE.has(entry.status)) continue;
    const end = Math.min(input.timeline[i + 1]?.at ?? until, until);
    total += businessMs(input.calendar, entry.at, end);
  }
  return total;
}

function metric(
  input: ClockInput,
  targetMinutes: number | null,
  stoppedAt: number | null,
): SlaMetricView | null {
  if (targetMinutes === null || input.timeline.length === 0) return null;
  const target = targetMinutes * MINUTE;
  const until = stoppedAt ?? input.now;
  const elapsed = running(input, until);
  const current = input.timeline.at(-1)!.status;
  let state: SlaState;
  let dueAt: number | null = null;
  if (stoppedAt !== null) {
    state = elapsed <= target ? 'met' : 'missed';
  } else if (elapsed > target) {
    state = 'breached';
  } else if (paused(current, input.pauseDuringApproval)) {
    state = 'paused';
  } else {
    state = elapsed >= target * AT_RISK_SHARE ? 'at_risk' : 'on_track';
    dueAt = addBusinessMs(input.calendar, input.now, target - elapsed);
  }
  return {
    state,
    targetMinutes,
    elapsedMinutes: Math.floor(elapsed / MINUTE),
    dueAt: dueAt === null ? null : new Date(dueAt).toISOString(),
    completedAt: stoppedAt === null ? null : new Date(stoppedAt).toISOString(),
  };
}

/** Both clocks of a request (SPEC §6.5). */
export function computeSla(
  input: ClockInput,
): Pick<RequestSlaView, 'firstResponse' | 'resolution'> {
  const last = input.timeline.at(-1);
  // Resolution stops when the request is done; the latest time it got there counts.
  let resolvedAt: number | null = null;
  if (last && DONE.has(last.status)) {
    resolvedAt = last.at;
    for (let i = input.timeline.length - 2; i >= 0 && DONE.has(input.timeline[i]!.status); i--) {
      resolvedAt = input.timeline[i]!.at;
    }
  }
  // Finishing without a word still answers the requester.
  const firstDone = input.timeline.find((e) => DONE.has(e.status))?.at ?? null;
  const responded =
    input.firstResponseAt === null
      ? firstDone
      : firstDone === null
        ? input.firstResponseAt
        : Math.min(input.firstResponseAt, firstDone);
  return {
    firstResponse: metric(input, input.firstResponseMinutes, responded),
    resolution: metric(input, input.resolutionMinutes, resolvedAt),
  };
}

const URGENCY: Record<SlaState, number> = {
  breached: 0,
  at_risk: 1,
  on_track: 2,
  paused: 3,
  missed: 4,
  met: 5,
};

/** The clock a queue should show: the most urgent running one, else the last finished. */
export function slaBadge(
  sla: Pick<RequestSlaView, 'firstResponse' | 'resolution'>,
): SlaBadge | null {
  const candidates = (['firstResponse', 'resolution'] as const)
    .map((name) => ({ name, value: sla[name] }))
    .filter(
      (c): c is { name: 'firstResponse' | 'resolution'; value: SlaMetricView } => c.value !== null,
    );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      URGENCY[a.value.state] - URGENCY[b.value.state] ||
      (a.value.dueAt ?? '').localeCompare(b.value.dueAt ?? ''),
  );
  const best = candidates[0]!;
  return { metric: best.name, state: best.value.state, dueAt: best.value.dueAt };
}
