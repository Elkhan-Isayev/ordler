import type { AuditEntryView } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { formatWhen } from '../issues/Comments.js';
import { ghostButtonClass, inputClass, Panel, SectionHeader } from './common.js';

interface Filters {
  action?: string;
  targetType?: string;
}

/** Admin → Audit log (SPEC §9): read-only, newest first, filter by action or target. */
export function AuditSection() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (before?: string) => {
      try {
        const page = await api.audit({ ...filters, before });
        setEntries((current) => (before ? [...current, ...page.entries] : page.entries));
        setNext(page.next);
        setError(undefined);
      } catch (failure) {
        setError(t(errorKey(failure)));
      }
    },
    [filters, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim() || undefined;
    setFilters({ action: text('action'), targetType: text('targetType') });
  }

  function actor(entry: AuditEntryView): string {
    if (entry.actor.type === 'system') return t('admin.audit.system');
    const name = entry.actor.name ?? t('admin.audit.unknown');
    return entry.actor.type === 'token' ? t('admin.audit.viaToken', { name }) : name;
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')} />
      {error && <FormError message={error} />}
      <form
        aria-label={t('admin.audit.filters')}
        onSubmit={filter}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('admin.audit.action')}
          <input name="action" placeholder="role.updated" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('admin.audit.target')}
          <input name="targetType" placeholder="request" className={inputClass} />
        </label>
        <button type="submit" className={ghostButtonClass}>
          {t('admin.audit.apply')}
        </button>
      </form>
      <Panel>
        {entries.length === 0 && <p className="text-sm text-ink-muted">{t('admin.audit.empty')}</p>}
        <ul className="flex flex-col divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <code className="text-ink">{entry.action}</code>
                  <span className="text-ink-muted">{actor(entry)}</span>
                  <span className="text-xs text-ink-faint">
                    {entry.targetType}
                    {entry.targetId ? ` · ${entry.targetId.slice(0, 8)}` : ''}
                  </span>
                  <span className="ml-auto text-xs text-ink-faint">
                    {formatWhen(entry.createdAt, i18n.language)}
                  </span>
                </summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {(['before', 'after'] as const).map((side) => (
                    <div key={side}>
                      <div className="text-xs text-ink-faint">{t(`admin.audit.${side}`)}</div>
                      <pre className="overflow-x-auto rounded-md bg-hover p-2 text-xs text-ink">
                        {entry[side] === null ? '—' : JSON.stringify(entry[side], null, 2)}
                      </pre>
                    </div>
                  ))}
                  {entry.ip && <div className="text-xs text-ink-faint">IP {entry.ip}</div>}
                </div>
              </details>
            </li>
          ))}
        </ul>
        {next && (
          <button type="button" className={ghostButtonClass} onClick={() => void load(next)}>
            {t('admin.audit.more')}
          </button>
        )}
      </Panel>
    </div>
  );
}
