import type { RequestSlaView, SlaBadge, SlaMetricView, SlaState } from '@ordler/shared';
import { useTranslation } from 'react-i18next';

const STATE_STYLE: Record<SlaState, string> = {
  on_track: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  at_risk: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  breached: 'bg-red-500/15 text-red-700 dark:text-red-300',
  paused: 'bg-hover text-ink-muted',
  met: 'bg-emerald-500/10 text-ink-muted',
  missed: 'bg-red-500/10 text-ink-muted',
};

/** "in 45 minutes" / "in 3 hours" / "in 2 days" in the UI language. */
export function relativeDue(language: string, dueAt: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(dueAt) - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (Math.abs(minutes) < 90) return format.format(minutes, 'minute');
  if (Math.abs(minutes) < 48 * 60) return format.format(Math.round(minutes / 60), 'hour');
  return format.format(Math.round(minutes / 1440), 'day');
}

/** The state as words plus colour, never colour alone. */
export function SlaStateChip({ state, dueAt }: { state: SlaState; dueAt: string | null }) {
  const { t, i18n } = useTranslation();
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[state]}`}
    >
      {t(`sla.state.${state}`)}
      {dueAt && ` · ${relativeDue(i18n.language, dueAt)}`}
    </span>
  );
}

/** Queue rows: the clock closest to breaching. */
export function SlaBadgeChip({ badge }: { badge: SlaBadge | null }) {
  const { t } = useTranslation();
  if (!badge || badge.state === 'met' || badge.state === 'missed') return null;
  return (
    <span title={t(`sla.metric.${badge.metric}`)}>
      <SlaStateChip state={badge.state} dueAt={badge.dueAt} />
    </span>
  );
}

function Clock({ name, metric }: { name: 'firstResponse' | 'resolution'; metric: SlaMetricView }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-ink-faint">{t(`sla.metric.${name}`)}</span>
      <SlaStateChip state={metric.state} dueAt={metric.dueAt} />
    </div>
  );
}

/** Both clocks on a request page (SPEC §6.5). */
export function SlaClocks({ sla }: { sla: RequestSlaView | null }) {
  const { t } = useTranslation();
  if (!sla || (!sla.firstResponse && !sla.resolution)) return null;
  return (
    <section aria-label={t('sla.title')} className="flex flex-col gap-2">
      {sla.firstResponse && <Clock name="firstResponse" metric={sla.firstResponse} />}
      {sla.resolution && <Clock name="resolution" metric={sla.resolution} />}
    </section>
  );
}
