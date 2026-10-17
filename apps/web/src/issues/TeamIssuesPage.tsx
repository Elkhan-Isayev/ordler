import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass } from '../admin/common.js';
import { FormError } from '../auth/form.js';
import { Link } from '../router.js';
import { IssueBoard } from './IssueBoard.js';
import { IssueList } from './IssueList.js';
import { NewIssueDialog } from './NewIssueDialog.js';
import { useTeamIssues } from './useTeamIssues.js';

export type IssueView = 'list' | 'board';

/** A team's issues as a list (/teams/KEY/issues) or a board (/teams/KEY/board). */
export function TeamIssuesPage({ teamKey, view }: { teamKey: string; view: IssueView }) {
  const { t } = useTranslation();
  const { team, issues, error, update, create } = useTeamIssues(teamKey);
  const [creating, setCreating] = useState<{ statusId?: string } | undefined>();

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
      href={`/teams/${team.key}/${target === 'list' ? 'issues' : 'board'}`}
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
      {error && (
        <div className="px-4 pt-3">
          <FormError message={t(error)} />
        </div>
      )}
      {view === 'board' ? (
        <IssueBoard
          team={team}
          issues={issues}
          onMove={(issue, patch) => void update(issue, patch)}
          onAdd={(statusId) => setCreating({ statusId })}
        />
      ) : (
        <IssueList statuses={team.statuses} issues={issues} />
      )}
      {creating && (
        <NewIssueDialog
          team={team}
          initialStatusId={creating.statusId}
          onCreate={create}
          onClose={() => setCreating(undefined)}
        />
      )}
    </div>
  );
}
