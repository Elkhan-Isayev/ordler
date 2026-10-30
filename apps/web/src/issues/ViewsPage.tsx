import type { SavedView } from '@ordler/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { Link } from '../router.js';
import { activeFilterCount } from './filters.js';
import { useViews, viewHref } from './SavedViews.js';

/** Saved views across the workspace (/views) or of one team (/teams/KEY/views). */
export function ViewsPage({ teamKey }: { teamKey?: string }) {
  const { t } = useTranslation();
  const { views, reload } = useViews(teamKey);
  const [error, setError] = useState<string>();

  async function remove(view: SavedView) {
    if (!window.confirm(t('views.confirmDelete', { name: view.name }))) return;
    setError(undefined);
    try {
      await api.deleteView(view.id);
      reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">
          {teamKey ? `${teamKey} · ` : ''}
          {t('nav.views')}
        </h1>
      </header>
      {error && (
        <div className="p-4">
          <FormError message={error} />
        </div>
      )}
      {views?.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('views.empty')}</p>
      )}
      <ul>
        {views?.map((view) => (
          <li key={view.id} className="flex items-center border-b border-line hover:bg-hover">
            <Link
              href={viewHref(view)}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{view.name}</span>
              <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-ink-muted">
                {view.shared ? t('views.shared') : t('views.personal')}
              </span>
              <span className="text-xs text-ink-faint">{t(`views.layout.${view.layout}`)}</span>
              <span className="text-xs text-ink-faint">
                {t('views.filterCount', { count: activeFilterCount(view.filters) })}
              </span>
              {!teamKey && <span className="text-xs text-ink-faint">{view.team.key}</span>}
              {view.shared && view.owner && (
                <span className="text-xs text-ink-faint">{view.owner.name}</span>
              )}
            </Link>
            {view.canEdit && (
              <button
                type="button"
                aria-label={t('views.delete', { name: view.name })}
                className="mr-2 rounded-md p-1.5 text-ink-faint hover:bg-card hover:text-ink"
                onClick={() => void remove(view)}
              >
                <Trash2 aria-hidden size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
