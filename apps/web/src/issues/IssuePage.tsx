import {
  PRIORITIES,
  teamTopic,
  type CommentView,
  type IssueDetail,
  type IssueEvent,
  type IssueField,
  type Priority,
  type TeamView,
  type UpdateIssueInput,
} from '@ordler/shared';
import type { TFunction } from 'i18next';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { RichEditor } from '../editor/RichEditor.js';
import { useRealtime } from '../realtime/client.js';
import { Link, navigate } from '../router.js';
import { CommentComposer, CommentItem, formatWhen } from './Comments.js';
import { AssigneePicker, assigneePatch } from './AssigneePicker.js';
import { CyclePicker } from '../cycles/CyclePicker.js';
import { cycleName } from '../cycles/format.js';
import { DueDatePicker } from './DueDatePicker.js';
import { IssueRelations, LabelPicker } from './IssueRelations.js';
import { Avatar, PriorityIcon, quietSelectClass, StatusIcon, statusLabel } from './ui.js';

type TimelineEntry =
  | { kind: 'event'; at: string; event: IssueEvent }
  | { kind: 'comment'; at: string; comment: CommentView };

/** History and comments in one chronological stream, like Linear's activity. */
export function timeline(issue: IssueDetail): TimelineEntry[] {
  return [
    ...issue.events.map((event) => ({ kind: 'event' as const, at: event.createdAt, event })),
    ...issue.comments.map((comment) => ({
      kind: 'comment' as const,
      at: comment.createdAt,
      comment,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

/** One issue (/issue/HELP-12): editable fields, properties and history, kept live. */
export function IssuePage({ identifier }: { identifier: string }) {
  const { t, i18n } = useTranslation();
  const [issue, setIssue] = useState<IssueDetail>();
  const [team, setTeam] = useState<TeamView>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const detail = await api.issue(identifier);
      setIssue(detail);
      setTeam(await api.team(detail.teamKey));
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [identifier]);

  useEffect(() => {
    setIssue(undefined);
    void reload();
  }, [reload]);

  useRealtime(
    team ? teamTopic(team.id) : undefined,
    (message) => {
      // Someone else changed this issue: refetch for the new history and description.
      if (message.type === 'issue.changed' && message.issue.id === issue?.id) void reload();
      // Deleted by someone else: the page now answers not found.
      if (message.type === 'issue.removed' && message.issueId === issue?.id) void reload();
    },
    () => void reload(),
  );

  async function save(patch: UpdateIssueInput) {
    if (!issue) return;
    try {
      setIssue(await api.updateIssue(issue.identifier, patch));
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
      void reload();
    }
  }

  async function remove() {
    if (!issue || !team) return;
    if (!window.confirm(t('issues.confirmDelete', { identifier: issue.identifier }))) return;
    try {
      await api.deleteIssue(issue.identifier);
      navigate(`/teams/${team.key}/issues`);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  const upload = team ? (file: File) => api.uploadAttachment(team.key, file) : undefined;

  /** Runs a comment action; the server answers with the fresh issue. */
  async function run(action: () => Promise<IssueDetail>): Promise<boolean> {
    try {
      setIssue(await action());
      setError(undefined);
      return true;
    } catch (failure) {
      setError(errorKey(failure));
      return false;
    }
  }

  if (!issue || !team) {
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

  const canEdit = team.can.update;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-ink-muted">
        <Link href={`/teams/${team.key}/board`} className="hover:text-ink">
          {team.name}
        </Link>
        <span>/</span>
        {/* Parent chain, so a sub-issue always shows where it belongs. */}
        {issue.ancestors.map((ancestor) => (
          <Fragment key={ancestor.id}>
            <Link
              href={`/issue/${ancestor.identifier}`}
              title={ancestor.title}
              className="hover:text-ink"
            >
              {ancestor.identifier}
            </Link>
            <span>›</span>
          </Fragment>
        ))}
        <span className="text-ink">{issue.identifier}</span>
        {team.can.delete && (
          <button
            type="button"
            className="ml-auto rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => void remove()}
          >
            {t('issues.delete')}
          </button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-8 md:px-12">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            <FormError message={error ? t(error) : undefined} />
            <input
              key={`title-${issue.updatedAt}`}
              defaultValue={issue.title}
              readOnly={!canEdit}
              aria-label={t('issues.title')}
              maxLength={255}
              className="bg-transparent text-2xl font-semibold tracking-tight text-ink outline-none"
              onBlur={(event) => {
                const title = event.currentTarget.value.trim();
                if (title && title !== issue.title) void save({ title });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <RichEditor
              value={issue.description}
              editable={canEdit}
              label={t('issues.description')}
              placeholder={t('issues.descriptionPlaceholder')}
              onCommit={(description) => void save({ description })}
              onUpload={upload}
              mentionables={team.members}
              onUploadError={(failure) => setError(errorKey(failure))}
            />
            <IssueRelations
              issue={issue}
              team={team}
              onChanged={() => void reload()}
              onError={(code) => setError(code)}
            />
            <section aria-label={t('issues.activity')} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-ink">{t('issues.activity')}</h2>
              <ol className="flex flex-col gap-3 text-sm text-ink-muted">
                {timeline(issue).map((entry) =>
                  entry.kind === 'event' ? (
                    <li key={entry.event.id} className="flex items-start gap-2">
                      <Avatar member={entry.event.actor} />
                      <span>
                        {describeEvent(t, entry.event, team)}
                        <span className="text-ink-faint">
                          {' '}
                          · {formatWhen(entry.event.createdAt, i18n.language)}
                        </span>
                      </span>
                    </li>
                  ) : (
                    <li key={entry.comment.id}>
                      <CommentItem
                        comment={entry.comment}
                        onUpload={upload}
                        mentionables={team.members}
                        onEdit={(body) => run(() => api.editComment(entry.comment.id, body))}
                        onDelete={async () => {
                          await run(() => api.deleteComment(entry.comment.id));
                        }}
                      />
                    </li>
                  ),
                )}
              </ol>
              {team.can.comment && (
                <CommentComposer
                  onUpload={upload}
                  mentionables={team.members}
                  onUploadError={(failure) => setError(errorKey(failure))}
                  onSend={(body) => run(() => api.addComment(issue.identifier, body))}
                />
              )}
            </section>
          </div>
        </main>
        <aside
          aria-label={t('issues.properties')}
          className="m-3 flex w-auto shrink-0 flex-col gap-4 self-start rounded-xl border border-line bg-card p-4 text-sm shadow-card md:w-72"
        >
          <Property label={t('issues.status.label')}>
            <StatusIcon category={issue.status.category} />
            <select
              value={issue.statusId}
              disabled={!canEdit}
              aria-label={t('issues.status.label')}
              className={quietSelectClass}
              onChange={(event) => void save({ statusId: event.target.value })}
            >
              {team.statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {statusLabel(t, status)}
                </option>
              ))}
            </select>
          </Property>
          <Property label={t('issues.priority.label')}>
            <PriorityIcon priority={issue.priority} />
            <select
              value={issue.priority}
              disabled={!canEdit}
              aria-label={t('issues.priority.label')}
              className={quietSelectClass}
              onChange={(event) => void save({ priority: event.target.value as Priority })}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t(`issues.priority.${priority}`)}
                </option>
              ))}
            </select>
          </Property>
          <Property label={t('issues.assignee')}>
            <AssigneePicker
              team={team}
              value={issue.assignees}
              quiet
              editable={team.can.assign}
              onChange={(ids) => void save(assigneePatch(team, ids))}
            />
          </Property>
          <Property label={t('issues.labels.label')}>
            <LabelPicker
              issue={issue}
              team={team}
              editable={canEdit}
              onSave={(labelIds) => save({ labelIds })}
              onTeamChanged={() => void reload()}
              onError={(code) => setError(code)}
            />
          </Property>
          {(team.cycles.length > 0 || issue.cycleId) && (
            <Property label={t('cycles.cycle')}>
              <CyclePicker
                team={team}
                value={issue.cycleId}
                editable={canEdit}
                className={quietSelectClass}
                onChange={(cycleId) => void save({ cycleId })}
              />
            </Property>
          )}
          <Property label={t('issues.dueDate')}>
            <DueDatePicker
              value={issue.dueDate}
              editable={canEdit}
              onChange={(dueDate) => void save({ dueDate })}
            />
          </Property>
        </aside>
      </div>
    </div>
  );
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-ink-faint">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Human-readable history line, resolving status and member ids against the team. */
export function describeEvent(t: TFunction, event: IssueEvent, team: TeamView): string {
  const name = event.actor?.name ?? t('issues.someone');
  // Agents act as the member; history says which token did it (SPEC §10.1).
  const actor = event.viaToken
    ? t('issues.viaToken', { actor: name, token: event.viaToken })
    : name;
  if (event.kind === 'created') return t('issues.event.created', { actor });
  const parts = (
    Object.entries(event.changes) as Array<[IssueField, { from: unknown; to: unknown }]>
  ).map(([field, change]) => {
    switch (field) {
      case 'statusId':
        return t('issues.event.status', { to: statusName(t, team, change.to) });
      case 'priority':
        return t('issues.event.priority', { to: t(`issues.priority.${String(change.to)}`) });
      case 'assigneeIds':
        return t('issues.event.assignees', {
          to: (change.to as string[]).map((id) => memberName(t, team, id)).join(', ') || '—',
        });
      case 'assigneeId':
        return change.to
          ? t('issues.event.assigned', { to: memberName(t, team, change.to) })
          : t('issues.event.unassigned');
      case 'title':
        return t('issues.event.title', { to: String(change.to) });
      case 'description':
        return t('issues.event.description');
      case 'dueDate':
        return change.to
          ? t('issues.event.dueDate', { to: String(change.to) })
          : t('issues.event.dueDateCleared');
      case 'triage':
        return change.to === 'accepted'
          ? t('issues.event.accepted')
          : change.to === 'duplicate'
            ? t('issues.event.duplicate')
            : t('issues.event.declined');
      case 'duplicateOf':
        return '';
      case 'labelIds':
        return t('issues.event.labels', {
          to: (change.to as string[]).map((id) => labelName(t, team, id)).join(', ') || '—',
        });
      case 'cycleId':
        return change.to
          ? t('issues.event.cycle', { to: cycleLabel(t, team, change.to) })
          : t('issues.event.cycleRemoved');
      case 'parentId':
        return change.to ? t('issues.event.parent') : t('issues.event.parentRemoved');
    }
  });
  return `${actor}: ${parts.filter(Boolean).join(', ')}`;
}

function statusName(t: TFunction, team: TeamView, id: unknown): string {
  const status = team.statuses.find((s) => s.id === id);
  return status ? statusLabel(t, status) : '—';
}

function cycleLabel(t: TFunction, team: TeamView, id: unknown): string {
  const cycle = team.cycles.find((c) => c.id === id);
  return cycle ? cycleName(t, cycle) : t('cycles.finished');
}

function labelName(t: TFunction, team: TeamView, id: string): string {
  return team.labels.find((l) => l.id === id)?.name ?? t('issues.labels.deleted');
}

function memberName(t: TFunction, team: TeamView, id: unknown): string {
  return team.members.find((m) => m.id === id)?.name ?? t('issues.someone');
}
