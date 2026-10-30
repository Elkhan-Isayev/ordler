import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';

const DAY = 86_400_000;
const MIN_WEEKS = 8;
const WEEK_WIDTH = 64;

export interface TimelineItem {
  id: string;
  href: string;
  label: string;
  /** Shown before the label: an identifier or an icon. */
  prefix?: ReactNode;
  /** ISO dates; without a start the item is a single-day marker at `end`. */
  start: string | null;
  end: string;
  /** Bars of finished work are drawn muted. */
  done?: boolean;
  /** Accessible summary of the dates, e.g. "Mar 3 – Mar 14". */
  title: string;
}

const toDay = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);

/**
 * The visible span in whole weeks: from the Monday on or before the earliest date (or today) to
 * at least {@link MIN_WEEKS} later, so today always shows and short plans are not stretched.
 */
export function timelineRange(items: TimelineItem[], today: string) {
  const days = items.flatMap((item) => [toDay(item.start ?? item.end), toDay(item.end)]);
  const now = toDay(today);
  const first = Math.min(now, ...days);
  // Day 0 of the Unix epoch was a Thursday; shift so weeks start on Monday.
  const start = first - ((first + 3) % 7);
  const last = Math.max(now, ...days);
  const weeks = Math.max(MIN_WEEKS, Math.ceil((last - start + 1) / 7) + 1);
  return { start, weeks };
}

/** Offset and width of an item as fractions of the visible span. */
export function barGeometry(item: TimelineItem, range: { start: number; weeks: number }) {
  const total = range.weeks * 7;
  const from = toDay(item.start ?? item.end);
  const to = Math.max(from, toDay(item.end));
  return { left: (from - range.start) / total, width: (to - from + 1) / total };
}

/** Items as bars on a week grid (SPEC §5.4 timeline layout); scrolls sideways when long. */
export function Timeline({
  items,
  today = new Date().toISOString().slice(0, 10),
  label,
}: {
  items: TimelineItem[];
  today?: string;
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const range = timelineRange(items, today);
  const format = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const todayOffset = (toDay(today) - range.start + 0.5) / (range.weeks * 7);
  const track = { minWidth: range.weeks * WEEK_WIDTH };

  return (
    <div role="region" aria-label={label} className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-w-max flex-col">
        <div className="sticky top-0 z-10 flex border-b border-line bg-sidebar text-xs text-ink-faint">
          <div className="sticky left-0 w-72 shrink-0 border-r border-line bg-sidebar px-4 py-2" />
          <div className="relative flex flex-1" style={track}>
            {Array.from({ length: range.weeks }, (_, week) => (
              <span key={week} className="flex-1 border-l border-line px-1.5 py-2">
                {format.format(new Date((range.start + week * 7) * DAY))}
              </span>
            ))}
          </div>
        </div>
        <ul>
          {items.map((item) => {
            const bar = barGeometry(item, range);
            return (
              <li key={item.id} className="flex border-b border-line text-sm">
                <Link
                  href={item.href}
                  className="sticky left-0 z-[1] flex w-72 shrink-0 items-center gap-2 truncate border-r border-line bg-surface px-4 py-2 hover:bg-hover"
                >
                  {item.prefix}
                  <span className="truncate text-ink">{item.label}</span>
                </Link>
                <div className="relative flex-1" style={track}>
                  <span
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-accent"
                    style={{ left: `${todayOffset * 100}%` }}
                  />
                  <Link
                    href={item.href}
                    title={item.title}
                    aria-label={`${item.label}: ${item.title}`}
                    className={`absolute top-1/2 h-5 -translate-y-1/2 rounded-md ${
                      item.start ? '' : 'min-w-3'
                    } ${item.done ? 'opacity-40' : ''}`}
                    style={{
                      left: `${bar.left * 100}%`,
                      width: `${bar.width * 100}%`,
                      background: 'var(--color-chart-done)',
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {items.length === 0 && (
          <p className="p-8 text-center text-sm text-ink-muted">{t('timeline.empty')}</p>
        )}
      </div>
    </div>
  );
}
