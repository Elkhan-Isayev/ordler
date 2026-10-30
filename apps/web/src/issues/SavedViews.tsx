import type { SavedView, TeamView, ViewLayout } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { serializeFilters, type IssueFilters } from './filters.js';
import { selectClass } from './ui.js';

const LAYOUT_PATH: Record<ViewLayout, string> = {
  list: 'issues',
  board: 'board',
  timeline: 'timeline',
};

/** The team page URL for a layout, filters and (optionally) the saved view they came from. */
export function layoutHref(
  teamKey: string,
  layout: ViewLayout,
  filters: IssueFilters,
  viewId?: string,
): string {
  const query = serializeFilters(filters);
  const view = viewId ? `${query ? '&' : '?'}view=${viewId}` : '';
  return `/teams/${teamKey}/${LAYOUT_PATH[layout]}${query}${view}`;
}

export const viewHref = (view: SavedView) =>
  layoutHref(view.team.key, view.layout, view.filters, view.id);

/** The views of one team (or the whole workspace); a failed load just shows none. */
export function useViews(teamKey?: string) {
  const [views, setViews] = useState<SavedView[]>();
  const reload = useCallback(() => {
    api
      .views(teamKey)
      .then(setViews)
      .catch(() => setViews([]));
  }, [teamKey]);
  useEffect(reload, [reload]);
  return { views, reload };
}

/**
 * Picks a saved view for the team page and saves the current filters and layout, either back
 * into the open view or as a new one (SPEC §5.4).
 */
export function ViewPicker({
  team,
  layout,
  filters,
  viewId,
  onOpen,
}: {
  team: TeamView;
  layout: ViewLayout;
  filters: IssueFilters;
  viewId: string | undefined;
  /** Shows a saved view (or no view, with filters cleared) on the page. */
  onOpen: (view: SavedView | undefined) => void;
}) {
  const { t } = useTranslation();
  const { views, reload } = useViews(team.key);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const active = views?.find((view) => view.id === viewId);
  const changed =
    active !== undefined &&
    (active.layout !== layout || serializeFilters(active.filters) !== serializeFilters(filters));

  async function saveChanges() {
    if (!active) return;
    setError(undefined);
    try {
      await api.updateView(active.id, { layout, filters });
      reload();
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={t('views.picker')}
        value={active?.id ?? ''}
        className={selectClass}
        onChange={(event) => {
          onOpen(views?.find((view) => view.id === event.target.value));
        }}
      >
        <option value="">{t('views.allIssues')}</option>
        {views?.map((view) => (
          <option key={view.id} value={view.id}>
            {view.shared ? view.name : t('views.personalName', { name: view.name })}
          </option>
        ))}
      </select>
      {changed && active.canEdit && (
        <button type="button" className={ghostButtonClass} onClick={() => void saveChanges()}>
          {t('views.saveChanges')}
        </button>
      )}
      <button type="button" className={ghostButtonClass} onClick={() => setSaving(true)}>
        {t('views.saveAs')}
      </button>
      {error && <FormError message={error} />}
      {saving && (
        <SaveViewDialog
          canShare={team.can.shareViews}
          onClose={() => setSaving(false)}
          onSave={async (name, shared) => {
            const created = await api.createView(team.key, { name, shared, layout, filters });
            setSaving(false);
            reload();
            onOpen(created);
          }}
        />
      )}
    </div>
  );
}

function SaveViewDialog({
  canShare,
  onClose,
  onSave,
}: {
  canShare: boolean;
  onClose: () => void;
  onSave: (name: string, shared: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    try {
      await onSave(String(form.get('name') ?? '').trim(), form.get('shared') === 'on');
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/40 p-4 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t('views.saveAs')}
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-card p-5 shadow-2xl"
      >
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('views.name')}
          <input
            name="name"
            required
            maxLength={80}
            autoFocus
            className="rounded-md border border-line bg-transparent px-2 py-1.5 text-sm text-ink"
          />
        </label>
        {canShare && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="shared" />
            {t('views.shareWithTeam')}
          </label>
        )}
        {error && <FormError message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            {t('issues.cancel')}
          </button>
          <button type="submit" className={buttonClass}>
            {t('views.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
