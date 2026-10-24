import { describe, expect, it } from 'vitest';
import type { BusinessCalendar } from './business-time.js';
import { computeSla, slaBadge, type ClockInput } from './clock.js';

const H = 3_600_000;
const t0 = Date.parse('2026-10-26T09:00:00Z'); // a Monday

function input(overrides: Partial<ClockInput>): ClockInput {
  return {
    calendar: null,
    pauseDuringApproval: true,
    firstResponseMinutes: 60,
    resolutionMinutes: 8 * 60,
    timeline: [{ at: t0, status: 'open' }],
    firstResponseAt: null,
    now: t0,
    ...overrides,
  };
}

describe('SLA clocks', () => {
  it('runs on track, then at risk from 75 %, then breached', () => {
    expect(computeSla(input({ now: t0 + 30 * 60_000 })).firstResponse).toMatchObject({
      state: 'on_track',
      elapsedMinutes: 30,
      dueAt: new Date(t0 + H).toISOString(),
    });
    expect(computeSla(input({ now: t0 + 45 * 60_000 })).firstResponse!.state).toBe('at_risk');
    expect(computeSla(input({ now: t0 + 61 * 60_000 })).firstResponse).toMatchObject({
      state: 'breached',
      dueAt: null,
    });
  });

  it('stops the first-response clock at the first answer', () => {
    const sla = computeSla(input({ firstResponseAt: t0 + 20 * 60_000, now: t0 + 5 * H }));
    expect(sla.firstResponse).toMatchObject({ state: 'met', elapsedMinutes: 20 });
    expect(sla.resolution!.state).toBe('on_track');
    const late = computeSla(input({ firstResponseAt: t0 + 2 * H, now: t0 + 5 * H }));
    expect(late.firstResponse!.state).toBe('missed');
  });

  it('pauses while waiting for the requester and, by policy, during approvals', () => {
    const timeline: ClockInput['timeline'] = [
      { at: t0, status: 'pending_approval' },
      { at: t0 + 2 * H, status: 'open' },
      { at: t0 + 3 * H, status: 'waiting_for_requester' },
      { at: t0 + 10 * H, status: 'in_progress' },
    ];
    const sla = computeSla(input({ timeline, firstResponseAt: t0 + 3 * H, now: t0 + 11 * H }));
    // Ran 1 h (open) + 1 h (in progress).
    expect(sla.resolution).toMatchObject({ state: 'on_track', elapsedMinutes: 120 });
    const counted = computeSla(
      input({
        timeline,
        pauseDuringApproval: false,
        firstResponseAt: t0 + 3 * H,
        now: t0 + 11 * H,
      }),
    );
    expect(counted.resolution!.elapsedMinutes).toBe(240);
    const waiting = computeSla(input({ timeline: timeline.slice(0, 3), now: t0 + 5 * H }));
    expect(waiting.resolution).toMatchObject({ state: 'paused', dueAt: null });
  });

  it('stops on resolution and resumes when reopened', () => {
    const resolved = computeSla(
      input({
        timeline: [
          { at: t0, status: 'open' },
          { at: t0 + 2 * H, status: 'resolved' },
          { at: t0 + 3 * H, status: 'closed' },
        ],
        now: t0 + 20 * H,
      }),
    );
    // Resolving without a comment also counts as the first response.
    expect(resolved.firstResponse).toMatchObject({ state: 'missed', elapsedMinutes: 120 });
    expect(resolved.resolution).toMatchObject({
      state: 'met',
      completedAt: new Date(t0 + 2 * H).toISOString(),
    });
    const reopened = computeSla(
      input({
        timeline: [
          { at: t0, status: 'open' },
          { at: t0 + 2 * H, status: 'resolved' },
          { at: t0 + 5 * H, status: 'in_progress' },
        ],
        now: t0 + 6 * H,
      }),
    );
    expect(reopened.resolution).toMatchObject({ state: 'on_track', elapsedMinutes: 180 });
  });

  it('counts business hours only', () => {
    const office: BusinessCalendar = {
      timezone: 'UTC',
      hours: [1, 2, 3, 4, 5].map((day) => ({ day, start: 9 * 60, end: 17 * 60 })),
      holidays: [],
    };
    // Friday 16:00 UTC, 2 h target → due Monday 10:00.
    const friday = Date.parse('2026-10-30T16:00:00Z');
    const sla = computeSla(
      input({
        calendar: office,
        firstResponseMinutes: 120,
        timeline: [{ at: friday, status: 'open' }],
        now: friday + 24 * H,
      }),
    );
    expect(sla.firstResponse).toMatchObject({
      state: 'on_track',
      elapsedMinutes: 60,
      dueAt: '2026-11-02T10:00:00.000Z',
    });
  });

  it('leaves out clocks without a target and picks the most urgent for queues', () => {
    const sla = computeSla(input({ firstResponseMinutes: null, now: t0 + 7 * H }));
    expect(sla.firstResponse).toBeNull();
    expect(slaBadge(sla)).toMatchObject({ metric: 'resolution', state: 'at_risk' });
    expect(slaBadge({ firstResponse: null, resolution: null })).toBeNull();
    const both = computeSla(input({ now: t0 + 2 * H }));
    expect(slaBadge(both)).toMatchObject({ metric: 'firstResponse', state: 'breached' });
  });
});
