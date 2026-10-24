import type { CycleDetail, CycleView, TeamCycles } from '@ordler/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { IssueList } from '../issues/IssueList.js';
import { Link, navigate } from '../router.js';
import { BurnupChart } from './BurnupChart.js';
import { cycleDates, cycleName } from './format.js';

function Progress({ cycle }: { cycle: CycleView }) {
  const { t } = useTranslation();
  const { total, started, completed } = cycle.progress;
  const part = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-hover">
        <span style={{ width: `${part(completed)}%`, background: 'var(--color-chart-done)' }} />
        <span
          className="ml-0.5"
          style={{ width: `${part(started)}%`, background: 'var(--color-chart-scope)' }}
        />
      </div>
      <span className="text-xs text-ink-muted">
        {t('cycles.progress', { completed, total, percent: Math.round(part(completed)) })}
      </span>
    </div>
  );
}

/**
 * A team's cycles (/teams/KEY/cycles, /cycles/upcoming); `/cycles/current` opens the current
 * one directly. Shows how to turn cycles on when they are off.
 */
export function CyclesPage({
  teamKey,
  filter = 'all',
}: {
  teamKey: string;
  filter?: 'all' | 'current' | 'upcoming';
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<TeamCycles>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .teamCycles(teamKey)
      .then((loaded) => {
        const current = loaded.cycles.find((c) => c.state === 'current');
        if (filter === 'current' && current) {
          navigate(`/cycles/${current.id}`);
          return;
        }
        setData(loaded);
      })
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [teamKey, filter]);

  const shown =
    data?.cycles.filter(
      (c) => filter === 'all' || (filter === 'upcoming' && c.state === 'upcoming'),
    ) ?? [];
  const groups = (['current', 'upcoming', 'past'] as const)
    .map((state) => ({ state, items: shown.filter((c) => c.state === state) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-ink">
          {teamKey} · {t('nav.cycles')}
        </h1>
        <Link
          href={`/teams/${teamKey}/settings`}
          className="ml-auto text-sm text-ink-muted hover:text-ink"
        >
          {t('cycles.settings')}
        </Link>
      </header>
      {error && <FormError message={t(error)} />}
      {data && !data.settings.enabled && (
        <p className="rounded-xl border border-dashed border-line p-6 text-sm text-ink-muted">
          {t('cycles.off')}
        </p>
      )}
      {groups.map((group) => (
        <section
          key={group.state}
          aria-label={t(`cycles.state.${group.state}`)}
          className="flex flex-col gap-2"
        >
          <h2 className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            {t(`cycles.state.${group.state}`)}
          </h2>
          {group.items.map((cycle) => (
            <Link
              key={cycle.id}
              href={`/cycles/${cycle.id}`}
              className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4 shadow-card hover:border-ink-faint"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-medium text-ink">{cycleName(t, cycle)}</span>
                <span className="text-xs text-ink-faint">{cycleDates(cycle, i18n.language)}</span>
              </span>
              <Progress cycle={cycle} />
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

/** One cycle (/cycles/:id): dates, progress, burn-up, scope change and its issues. */
export function CyclePage({ cycleId }: { cycleId: string }) {
  const { t, i18n } = useTranslation();
  const [cycle, setCycle] = useState<CycleDetail>();
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    api
      .cycle(cycleId)
      .then(setCycle)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [cycleId]);
  useEffect(reload, [reload]);

  if (!cycle) return <div className="p-8">{error && <FormError message={t(error)} />}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-ink-muted">
        <Link href={`/teams/${cycle.team.key}/cycles`} className="hover:text-ink">
          {cycle.team.name} · {t('nav.cycles')}
        </Link>
        <span>/</span>
        <span className="text-ink">{cycleName(t, cycle)}</span>
        <Link
          href={`/teams/${cycle.team.key}/board?cycle=${cycle.id}`}
          className="ml-auto rounded-lg px-2 py-1 hover:bg-hover hover:text-ink"
        >
          {t('cycles.openBoard')}
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{cycleName(t, cycle)}</h1>
          <span className="text-sm text-ink-muted">
            {cycleDates(cycle, i18n.language)} · {t(`cycles.state.${cycle.state}`)}
          </span>
        </div>
        <Progress cycle={cycle} />
        <section className="rounded-xl border border-line bg-card p-4 shadow-card">
          <BurnupChart points={cycle.burnup} language={i18n.language} />
          {cycle.addedAfterStart > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              {t('cycles.scopeChange', { count: cycle.addedAfterStart })}
            </p>
          )}
        </section>
      </div>
      <IssueList statuses={undefined} issues={cycle.issues} />
    </div>
  );
}
