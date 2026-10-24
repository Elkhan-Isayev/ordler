import { describe, expect, it } from 'vitest';
import {
  addDays,
  burnup,
  cycleEnd,
  cycleState,
  firstCycleStart,
  nextCycleStart,
} from './planning.js';

describe('cycle planning', () => {
  it('aligns the first cycle to the start weekday', () => {
    // 2026-10-22 is a Thursday.
    expect(firstCycleStart('2026-10-22', 1)).toBe('2026-10-19');
    expect(firstCycleStart('2026-10-22', 4)).toBe('2026-10-22');
    expect(firstCycleStart('2026-10-22', 5)).toBe('2026-10-16');
    expect(firstCycleStart('2026-10-25', 7)).toBe('2026-10-25');
  });

  it('computes ends, cooldowns and states', () => {
    expect(cycleEnd('2026-10-19', 2)).toBe('2026-11-01');
    expect(nextCycleStart('2026-11-01', 0)).toBe('2026-11-02');
    expect(nextCycleStart('2026-11-01', 1)).toBe('2026-11-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    const cycle = { startsOn: '2026-10-19', endsOn: '2026-11-01' };
    expect(cycleState(cycle, '2026-10-18')).toBe('upcoming');
    expect(cycleState(cycle, '2026-10-19')).toBe('current');
    expect(cycleState(cycle, '2026-11-01')).toBe('current');
    expect(cycleState(cycle, '2026-11-02')).toBe('past');
  });

  it('builds a burn-up with scope changes from history', () => {
    const points = burnup('c1', '2026-10-19', '2026-10-21', [
      // In from the start, completed on day 2.
      {
        cycle: [{ at: '2026-10-18T10:00:00Z', cycleId: 'c1' }],
        status: [
          { at: '2026-10-18T10:00:00Z', category: 'unstarted' },
          { at: '2026-10-20T12:00:00Z', category: 'completed' },
        ],
      },
      // Added on day 3 (scope change).
      {
        cycle: [
          { at: '2026-10-18T10:00:00Z', cycleId: null },
          { at: '2026-10-21T09:00:00Z', cycleId: 'c1' },
        ],
        status: [{ at: '2026-10-18T10:00:00Z', category: 'started' }],
      },
      // Moved out on day 2.
      {
        cycle: [
          { at: '2026-10-18T10:00:00Z', cycleId: 'c1' },
          { at: '2026-10-20T09:00:00Z', cycleId: 'c2' },
        ],
        status: [{ at: '2026-10-18T10:00:00Z', category: 'unstarted' }],
      },
    ]);
    expect(points).toEqual([
      { date: '2026-10-19', scope: 2, completed: 0 },
      { date: '2026-10-20', scope: 1, completed: 1 },
      { date: '2026-10-21', scope: 2, completed: 1 },
    ]);
  });
});
