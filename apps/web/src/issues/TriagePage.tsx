import { teamTopic, type IssueSummary, type TeamView, type TriageAction } from '@ordler/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { useRealtime } from '../realtime/client.js';
import { Link } from '../router.js';
import { PriorityIcon, selectClass, statusLabel } from './ui.js';
import { compareIssues, upsertIssue } from './useTeamIssues.js';

/**
 * Triage (SPEC §5.2): issues filed by people outside the team wait here until a member
 * accepts them into the workflow or declines them with a reason.
 */
export function TriagePage({ teamKey }: { teamKey: string }) {
  const { t } = useTranslation();
  const [team, setTeam] = useState<TeamView>();
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [view, list] = await Promise.all([api.team(teamKey), api.teamTriage(teamKey)]);
      setTeam(view);
      setIssues([...list].sort(compareIssues));
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [teamKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRealtime(
    team ? teamTopic(team.id) : undefined,
    (message) => {
      if (message.type !== 'issue.changed' || message.issue.teamId !== team?.id) return;
      const changed = message.issue;
      // New filings appear, and items decided in another tab disappear.
      setIssues((list) =>
        changed.inTriage ? upsertIssue(list, changed) : list.filter((i) => i.id !== changed.id),
      );
    },
    () => void reload(),
  );

  async function decide(issue: IssueSummary, decision: TriageAction) {
    try {
      await api.decideTriage(issue.identifier, decision);
      setIssues((list) => list.filter((item) => item.id !== issue.id));
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
    }
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">
          <span className="text-ink-faint">{team.name} / </span>
          {t('nav.triage')}
        </h1>
        <span className="text-xs text-ink-faint">{issues.length}</span>
      </header>
      {error && (
        <div className="px-4 pt-3">
          <FormError message={t(error)} />
        </div>
      )}
      {issues.length === 0 ? (
        <p className="p-8 text-center text-sm text-ink-muted">{t('triage.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3 p-4">
          {issues.map((issue) => (
            <TriageItem
              key={issue.id}
              team={team}
              issue={issue}
              onDecide={(d) => decide(issue, d)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TriageItem({
  team,
  issue,
  onDecide,
}: {
  team: TeamView;
  issue: IssueSummary;
  onDecide: (decision: TriageAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'idle' | 'decline' | 'duplicate'>('idle');
  const [original, setOriginal] = useState('');
  const [statusId, setStatusId] = useState(
    () => team.statuses.find((s) => s.isDefault)?.id ?? team.statuses[0]!.id,
  );
  const [assigneeId, setAssigneeId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(decision: TriageAction) {
    setBusy(true);
    await onDecide(decision);
    setBusy(false);
  }

  return (
    <li
      aria-label={issue.identifier}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 text-sm"
    >
      <Link href={`/issue/${issue.identifier}`} className="flex items-center gap-2 hover:underline">
        <PriorityIcon priority={issue.priority} />
        <span className="text-ink-faint">{issue.identifier}</span>
        <span className="text-ink">{issue.title}</span>
      </Link>
      {team.can.update &&
        (mode === 'duplicate' ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={original}
              onChange={(event) => setOriginal(event.target.value)}
              maxLength={40}
              aria-label={t('triage.duplicateOf')}
              placeholder={`${team.key}-1`}
              className={`${inputClass} w-40`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !original.trim()}
              onClick={() => void run({ action: 'duplicate', of: original.trim() })}
            >
              {t('triage.markDuplicate')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setMode('idle')}>
              {t('issues.cancel')}
            </button>
          </div>
        ) : mode === 'decline' ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
              aria-label={t('triage.reason')}
              placeholder={t('triage.reason')}
              className={`${inputClass} min-w-64 flex-1`}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !reason.trim()}
              onClick={() => void run({ action: 'decline', reason: reason.trim() })}
            >
              {t('triage.decline')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setMode('idle')}>
              {t('issues.cancel')}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusId}
              onChange={(event) => setStatusId(event.target.value)}
              aria-label={`${t('issues.status.label')}: ${issue.identifier}`}
              className={selectClass}
            >
              {team.statuses
                .filter((status) => status.category !== 'canceled')
                .map((status) => (
                  <option key={status.id} value={status.id}>
                    {statusLabel(t, status)}
                  </option>
                ))}
            </select>
            {team.can.assign && (
              <select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                aria-label={`${t('issues.assignee')}: ${issue.identifier}`}
                className={selectClass}
              >
                <option value="">{t('issues.noAssignee')}</option>
                {team.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run({ action: 'accept', statusId, ...(assigneeId ? { assigneeId } : {}) })
              }
            >
              {t('triage.accept')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setMode('duplicate')}>
              {t('triage.duplicate')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setMode('decline')}>
              {t('triage.decline')}
            </button>
          </div>
        ))}
    </li>
  );
}
