import { z } from 'zod';
import { PRIORITIES, type Priority } from './status.js';

/** SLA (SPEC §6.5): business calendars, policies per request type, and the clocks they run. */

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);

export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const calendarInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().min(1).max(64).refine(isTimezone, 'invalid_timezone'),
  /** Working intervals per ISO weekday (1 = Monday … 7 = Sunday). */
  hours: z
    .array(
      z
        .object({ day: z.number().int().min(1).max(7), start: time, end: time })
        .refine((h) => timeToMinutes(h.end) > timeToMinutes(h.start), 'end_before_start'),
    )
    .min(1)
    .max(50),
  holidays: z.array(z.iso.date()).max(400).default([]),
});
export type CalendarInput = z.input<typeof calendarInputSchema>;

export interface CalendarView {
  id: string;
  departmentId: string;
  name: string;
  timezone: string;
  hours: Array<{ day: number; start: string; end: string }>;
  holidays: string[];
}

const minutes = z.number().int().min(1).max(525_600).nullable();
const target = z.object({
  firstResponseMinutes: minutes.default(null),
  resolutionMinutes: minutes.default(null),
});

export const slaPolicyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Null: the clocks run around the clock. */
  calendarId: z.uuid().nullable().default(null),
  /** The clock stops while approvals are pending (it always stops while waiting for the requester). */
  pauseDuringApproval: z.boolean().default(true),
  targets: z.object(
    Object.fromEntries(
      PRIORITIES.map((p) => [
        p,
        target.default({ firstResponseMinutes: null, resolutionMinutes: null }),
      ]),
    ) as Record<Priority, z.ZodDefault<typeof target>>,
  ),
});
export type SlaPolicyInput = z.input<typeof slaPolicyInputSchema>;
export type SlaTargets = Record<
  Priority,
  { firstResponseMinutes: number | null; resolutionMinutes: number | null }
>;

export interface SlaPolicyView {
  id: string;
  departmentId: string;
  name: string;
  calendar: { id: string; name: string } | null;
  pauseDuringApproval: boolean;
  targets: SlaTargets;
  archivedAt: string | null;
}

export const SLA_STATES = ['on_track', 'at_risk', 'breached', 'paused', 'met', 'missed'] as const;
export type SlaState = (typeof SLA_STATES)[number];

/** One clock of a request: first response or resolution. */
export interface SlaMetricView {
  state: SlaState;
  targetMinutes: number;
  /** Business minutes used so far (or until it stopped). */
  elapsedMinutes: number;
  /** When it breaches if nothing changes; null while paused or stopped. */
  dueAt: string | null;
  completedAt: string | null;
}

export interface RequestSlaView {
  policy: { id: string; name: string };
  firstResponse: SlaMetricView | null;
  resolution: SlaMetricView | null;
}

/** The SLA fact worth showing in a queue row: the clock closest to breaching. */
export interface SlaBadge {
  metric: 'firstResponse' | 'resolution';
  state: SlaState;
  dueAt: string | null;
}
