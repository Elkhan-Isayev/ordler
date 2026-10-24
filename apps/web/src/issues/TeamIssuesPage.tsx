import { PRIORITIES, type Priority, type TeamView } from '@ordler/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass } from '../admin/common.js';
import { FormError } from '../auth/form.js';
import { Link } from '../router.js';
import { IssueBoard } from './IssueBoard.js';
import { IssueList } from './IssueList.js';
import {
  activeFilterCount,
  applyFilters,
  parseFilters,
  serializeFilters,
  type IssueFilters,
} from './filters.js';
import { IssueContextMenu, type MenuPosition } from './IssueContextMenu.js';
import { NewIssueDialog } from './NewIssueDialog.js';
import { cycleName } from '../cycles/format.js';
import { selectClass, statusLabel } from './ui.js';
import { useTeamIssues } from './useTeamIssues.js';

export type IssueView = 'list' | 'board';

/** A team's issues as a list (/teams/KEY/issues) or a board (/teams/KEY/board). */
export function TeamIssuesPage({ teamKey, view }: { teamKey: string; view: IssueView }) {
  const { t } = useTranslation();
  const { team, issues, error, update, create, remove } = useTeamIssues(teamKey);
  const [menu, setMenu] = useState<MenuPosition>();
  const [creating, setCreating] = useState<{ statusId?: string } | undefined>();
  const [filters, setFilters] = useState<IssueFilters>(() => parseFilters(window.location.search));

  function changeFilters(next: IssueFilters) {
    setFilters(next);
    // Keeps the filtered view in the address bar so it can be shared or reloaded.
    window.history.replaceState(null, '', `${window.location.pathname}${serializeFilters(next)}`);
  }

  if (!team) {
    return (
      <div className="p-8">
        {error ? (
          <FormError message={t(error)} />
        ) : (
          <p className="text-sm text-ink-muted">{t('auth.loading')}</p>
        )}
      </div>
    );
  }

  const tab = (target: IssueView, label: string) => (
    <Link
      href={`/teams/${team.key}/${target === 'list' ? 'issues' : 'board'}${serializeFilters(filters)}`}
      aria-current={view === target ? 'page' : undefined}
      className={`rounded-md px-2 py-1 text-sm ${
        view === target ? 'bg-hover text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">
          <span className="text-ink-faint">{team.department.name} / </span>
          {team.name}
        </h1>
        <nav aria-label={t('issues.layout')} className="flex gap-1">
          {tab('list', t('issues.list'))}
          {tab('board', t('issues.board'))}
        </nav>
        {team.can.create && (
          <button
            type="button"
            className={`${buttonClass} ml-auto`}
            onClick={() => setCreating({})}
          >
            {t('nav.newIssue')}
          </button>
        )}
      </header>
      <FilterBar team={team} filters={filters} onChange={changeFilters} />
      {error && (
        <div className="px-4 pt-3">
          <FormError message={t(error)} />
        </div>
      )}
      {view === 'board' ? (
        <IssueBoard
          team={team}
          issues={applyFilters(issues, filters)}
          onMove={(issue, patch) => void update(issue, patch)}
          onAdd={(statusId) => setCreating({ statusId })}
          onContextMenu={(issue, event) => setMenu({ issue, x: event.clientX, y: event.clientY })}
        />
      ) : (
        <IssueList
          statuses={team.statuses}
          issues={applyFilters(issues, filters)}
          onContextMenu={(issue, event) => setMenu({ issue, x: event.clientX, y: event.clientY })}
        />
      )}
      {menu && (
        <IssueContextMenu
          menu={menu}
          team={team}
          onUpdate={(issue, patch) => void update(issue, patch)}
          onDelete={(issue) => void remove(issue)}
          onClose={() => setMenu(undefined)}
        />
      )}
      {creating && (
        <NewIssueDialog
          team={team}
          initialStatusId={creating.statusId}
          parentIssues={issues}
          onCreate={create}
          onClose={() => setCreating(undefined)}
        />
      )}
    </div>
  );
}

/** Status, assignee, priority and label filters above the list and board. */
export function FilterBar({
  team,
  filters,
  onChange,
}: {
  team: TeamView;
  filters: IssueFilters;
  onChange: (filters: IssueFilters) => void;
}) {
  const { t } = useTranslation();
  const set = (key: keyof IssueFilters, value: string) =>
    onChange({ ...filters, [key]: value || undefined });
  return (
    <div
      role="group"
      aria-label={t('issues.filters.label')}
      className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2"
    >
      <select
        aria-label={t('issues.status.label')}
        value={filters.status ?? ''}
        className={selectClass}
        onChange={(event) => set('status', event.target.value)}
      >
        <option value="">{t('issues.filters.anyStatus')}</option>
        {team.statuses.map((status) => (
          <option key={status.id} value={status.id}>
            {statusLabel(t, status)}
          </option>
        ))}
      </select>
      <select
        aria-label={t('issues.assignee')}
        value={filters.assignee ?? ''}
        className={selectClass}
        onChange={(event) => set('assignee', event.target.value)}
      >
        <option value="">{t('issues.filters.anyAssignee')}</option>
        <option value="none">{t('issues.noAssignee')}</option>
        {team.members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t('issues.priority.label')}
        value={filters.priority ?? ''}
        className={selectClass}
        onChange={(event) => set('priority', event.target.value as Priority | '')}
      >
        <option value="">{t('issues.filters.anyPriority')}</option>
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {t(`issues.priority.${priority}`)}
          </option>
        ))}
      </select>
      {team.labels.length > 0 && (
        <select
          aria-label={t('issues.labels.label')}
          value={filters.label ?? ''}
          className={selectClass}
          onChange={(event) => set('label', event.target.value)}
        >
          <option value="">{t('issues.filters.anyLabel')}</option>
          {team.labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
      )}
      {team.cycles.length > 0 && (
        <select
          aria-label={t('cycles.cycle')}
          value={filters.cycle ?? ''}
          className={selectClass}
          onChange={(event) => set('cycle', event.target.value)}
        >
          <option value="">{t('cycles.anyCycle')}</option>
          <option value="none">{t('cycles.noCycle')}</option>
          {team.cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycleName(t, cycle)}
            </option>
          ))}
        </select>
      )}
      {activeFilterCount(filters) > 0 && (
        <button type="button" className={ghostButtonClass} onClick={() => onChange({})}>
          {t('issues.filters.clear')}
        </button>
      )}
    </div>
  );
}
