import type { IssueSummary } from '@ordler/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { IssueList } from './IssueList.js';
import { compareIssues } from './useTeamIssues.js';

/** Issues assigned to me across every team I can read, grouped by status category. */
export function MyIssuesPage() {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<IssueSummary[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .myIssues()
      .then((list) => setIssues([...list].sort(compareIssues)))
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{t('nav.myIssues')}</h1>
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {issues && <IssueList issues={issues} showTeam />}
    </div>
  );
}
