import { describe, expect, it } from 'vitest';
import {
  addBusinessMs,
  businessMs,
  isValidTimezone,
  localToInstant,
  type BusinessCalendar,
} from './business-time.js';

const HOUR = 3_600_000;
const at = (iso: string) => new Date(iso).getTime();

/** Mon–Fri 09:00–13:00 and 14:00–18:00 in Baku (UTC+4, no DST). */
const BAKU: BusinessCalendar = {
  timezone: 'Asia/Baku',
  hours: [1, 2, 3, 4, 5].flatMap((day) => [
    { day, start: 9 * 60, end: 13 * 60 },
    { day, start: 14 * 60, end: 18 * 60 },
  ]),
  holidays: ['2026-10-28'],
};

/** Every day 09:00–17:00 in Berlin, which switches to winter time on 2026-10-25. */
const BERLIN: BusinessCalendar = {
  timezone: 'Europe/Berlin',
  hours: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, start: 9 * 60, end: 17 * 60 })),
  holidays: [],
};

describe('business time', () => {
  it('converts local wall times across DST', () => {
    expect(localToInstant({ year: 2026, month: 10, day: 24 }, 9 * 60, 'Europe/Berlin')).toBe(
      at('2026-10-24T07:00:00Z'),
    );
    expect(localToInstant({ year: 2026, month: 10, day: 26 }, 9 * 60, 'Europe/Berlin')).toBe(
      at('2026-10-26T08:00:00Z'),
    );
    expect(isValidTimezone('Asia/Baku')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });

  it('counts only working hours, skipping lunch, weekends and holidays', () => {
    // Monday 2026-10-26, 10:00 → 15:00 Baku: 3 h before lunch + 1 h after.
    expect(businessMs(BAKU, at('2026-10-26T06:00:00Z'), at('2026-10-26T11:00:00Z'))).toBe(4 * HOUR);
    // Friday 17:00 → Monday 10:00: 1 h + 1 h.
    expect(businessMs(BAKU, at('2026-10-30T13:00:00Z'), at('2026-11-02T06:00:00Z'))).toBe(2 * HOUR);
    // Wednesday 2026-10-28 is a holiday.
    expect(businessMs(BAKU, at('2026-10-28T00:00:00Z'), at('2026-10-29T00:00:00Z'))).toBe(0);
    expect(businessMs(null, 0, 5 * HOUR)).toBe(5 * HOUR);
  });

  it('adds business time and lands inside working hours', () => {
    // Friday 17:00 Baku + 3 h → Monday 11:00.
    expect(addBusinessMs(BAKU, at('2026-10-30T13:00:00Z'), 3 * HOUR)).toBe(
      at('2026-11-02T07:00:00Z'),
    );
    // Tuesday 12:00 + 8 h: 5 h on Tuesday, Wednesday is a holiday, 3 h on Thursday → 12:00.
    expect(addBusinessMs(BAKU, at('2026-10-27T08:00:00Z'), 8 * HOUR)).toBe(
      at('2026-10-29T08:00:00Z'),
    );
    // Before opening: starts counting at 09:00.
    expect(addBusinessMs(BAKU, at('2026-10-26T01:00:00Z'), HOUR)).toBe(at('2026-10-26T06:00:00Z'));
    expect(addBusinessMs(null, 1000, 500)).toBe(1500);
  });

  it('round-trips over a DST change', () => {
    const start = at('2026-10-24T14:00:00Z'); // Saturday 16:00 Berlin (summer time)
    const due = addBusinessMs(BERLIN, start, 3 * HOUR);
    // 1 h on Saturday, then 2 h from Sunday 09:00 winter time (08:00 UTC).
    expect(due).toBe(at('2026-10-25T10:00:00Z'));
    expect(businessMs(BERLIN, start, due)).toBe(3 * HOUR);
  });

  it('terminates on a calendar without working time', () => {
    const empty: BusinessCalendar = { timezone: 'UTC', hours: [], holidays: [] };
    expect(addBusinessMs(empty, 0, HOUR)).toBeGreaterThan(365 * 86_400_000);
    expect(businessMs(empty, 0, 30 * 86_400_000)).toBe(0);
  });
});
