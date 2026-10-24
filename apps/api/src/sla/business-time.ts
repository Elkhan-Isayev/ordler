/**
 * Business-hours arithmetic for SLA clocks (SPEC §6.5), without a date library: wall times in
 * the calendar's IANA time zone are converted with Intl, so DST shifts are handled.
 */

export interface BusinessCalendar {
  timezone: string;
  /** Working intervals per ISO weekday (1 = Monday … 7 = Sunday), minutes after midnight. */
  hours: Array<{ day: number; start: number; end: number }>;
  /** Local dates (YYYY-MM-DD) without work. */
  holidays: string[];
}

const DAY_MS = 86_400_000;
/** Bounds every walk: a calendar with almost no hours must not loop for ever. */
const MAX_DAYS = 3 * 366;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    formatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a time zone. */
function wall(at: number, timezone: string) {
  const parts = Object.fromEntries(
    formatter(timezone)
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of the zone from UTC at an instant, in ms. */
function offset(at: number, timezone: string): number {
  const w = wall(at, timezone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant a local wall time happens; a time skipped by DST moves forward with the clock. */
export function localToInstant(
  date: { year: number; month: number; day: number },
  minutes: number,
  timezone: string,
): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day) + minutes * 60_000;
  const first = guess - offset(guess, timezone);
  return guess - offset(first, timezone);
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
  key: string;
}

function localDate(at: number, timezone: string): LocalDate {
  const w = wall(at, timezone);
  return dateFrom(Date.UTC(w.year, w.month - 1, w.day));
}

function dateFrom(utcMidnight: number): LocalDate {
  const d = new Date(utcMidnight);
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday,
    key: d.toISOString().slice(0, 10),
  };
}

function nextDate(date: LocalDate, step = 1): LocalDate {
  return dateFrom(Date.UTC(date.year, date.month - 1, date.day) + step * DAY_MS);
}

/** Working intervals of one local date as instants, in order. */
function workday(calendar: BusinessCalendar, date: LocalDate): Array<[number, number]> {
  if (calendar.holidays.includes(date.key)) return [];
  return calendar.hours
    .filter((h) => h.day === date.weekday && h.end > h.start)
    .sort((a, b) => a.start - b.start)
    .map((h) => [
      localToInstant(date, h.start, calendar.timezone),
      localToInstant(date, h.end, calendar.timezone),
    ]);
}

/** Business time between two instants; no calendar means around the clock. */
export function businessMs(calendar: BusinessCalendar | null, from: number, to: number): number {
  if (to <= from) return 0;
  if (!calendar) return to - from;
  let total = 0;
  // A day earlier: late local hours of the previous date can fall after `from` in UTC.
  let date = nextDate(localDate(from, calendar.timezone), -1);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [start, end] of workday(calendar, date)) {
      const a = Math.max(start, from);
      const b = Math.min(end, to);
      if (b > a) total += b - a;
    }
    if (localToInstant(date, 0, calendar.timezone) > to) break;
    date = nextDate(date);
  }
  return total;
}

/** The instant when `ms` of business time has passed after `from`. */
export function addBusinessMs(calendar: BusinessCalendar | null, from: number, ms: number): number {
  if (!calendar) return from + ms;
  let left = ms;
  let date = nextDate(localDate(from, calendar.timezone), -1);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [start, end] of workday(calendar, date)) {
      const a = Math.max(start, from);
      if (end <= a) continue;
      if (end - a >= left) return a + left;
      left -= end - a;
    }
    date = nextDate(date);
  }
  // No working time within the bound: the target is effectively never reached.
  return from + MAX_DAYS * DAY_MS;
}
