import { SlaClocks } from './Sla.js';
import {
  PRIORITIES,
  teamTopic,
  validateFormData,
  type FormValue,
  type Priority,
  type RequestAction,
  type RequestEventView,
  type RequestView,
  type TeamView,
} from '@ordler/shared';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { RichEditor } from '../editor/RichEditor.js';
import { formatWhen } from '../issues/Comments.js';
import { Avatar, PriorityIcon, selectClass } from '../issues/ui.js';
import { useRealtime } from '../realtime/client.js';
import { Link } from '../router.js';
import { ApprovalTimeline } from './ApprovalTimeline.js';
import { FormAnswers, FormFields, RequestStatusBadge } from './common.js';

/**
 * One request (/requests/REQ-57). The requester sees status, public comments and approval
 * progress; the receiving team also sees internal comments and linked issues and runs the
 * lifecycle (SPEC §6.2).
 */
export function RequestPage({ identifier }: { identifier: string }) {
  const { t, i18n } = useTranslation();
  const [request, setRequest] = useState<RequestView>();
  const [team, setTeam] = useState<TeamView>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const view = await api.request(identifier);
      setRequest(view);
      if (view.perspective === 'agent' && view.can.act) {
        setTeam(await api.team(view.targetTeam.key).catch(() => undefined));
      }
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [identifier]);

  useEffect(() => {
    void reload();
  }, [reload]);
  // Approvals, comments and status changes by others show up without a refresh.
  useRealtime(
    request ? teamTopic(request.targetTeam.id) : undefined,
    (message) => {
      if (message.type === 'request.changed' && message.identifier === identifier) void reload();
    },
    () => void reload(),
  );

  async function run(action: () => Promise<RequestView | undefined>): Promise<boolean> {
    try {
      const next = await action();
      if (next) setRequest(next);
      else await reload();
      setError(undefined);
      return true;
    } catch (failure) {
      setError(errorKey(failure));
      return false;
    }
  }

  if (!request) {
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

  const act = (body: RequestAction) => run(() => api.requestAction(request.identifier, body));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-sm">
        <span className="text-ink-faint">
          {request.department.name} · {request.requestType.name}
        </span>
        {request.group && (
          <Link
            href={`/request-groups/${request.group.identifier}`}
            className="text-ink-faint hover:underline"
          >
            · {request.group.identifier}
          </Link>
        )}
        <span className="text-ink">/ {request.identifier}</span>
        <span className="ml-auto">
          <RequestStatusBadge status={request.status} />
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
          <FormError message={error ? t(error) : undefined} />
          <h1 className="text-xl font-semibold text-ink">{request.title}</h1>
          {request.description && (
            <RichEditor
              value={request.description}
              editable={false}
              label={t('requests.description')}
              className="border-0"
            />
          )}
          <FormAnswers fields={request.fields} values={request.formData} />

          {request.can.resubmit && (
            <Resubmit request={request} onDone={(next) => setRequest(next)} />
          )}

          <ApprovalTimeline
            steps={request.approvals}
            onDecide={async (stepId, decision) =>
              run(async () => (await api.decideApproval(stepId, decision)).request)
            }
          />

          {request.siblings.length > 0 && (
            <section
              aria-label={t('requests.otherDepartments')}
              className="flex flex-col gap-1 text-sm"
            >
              <h2 className="text-sm font-semibold text-ink">{t('requests.otherDepartments')}</h2>
              {request.siblings.map((sibling) => (
                <p key={sibling.identifier} className="flex items-center gap-2">
                  <span className="text-ink-muted">{sibling.department.name}</span>
                  <span className="text-ink-faint">{sibling.identifier}</span>
                  <RequestStatusBadge status={sibling.status} />
                </p>
              ))}
            </section>
          )}

          <LinkedIssues
            request={request}
            onSpawn={() => run(() => api.spawnRequestIssue(request.identifier))}
          />

          <section aria-label={t('issues.activity')} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink">{t('issues.activity')}</h2>
            <ol className="flex flex-col gap-2 text-sm text-ink-muted">
              {timeline(request).map((entry) =>
                entry.kind === 'event' ? (
                  <li key={entry.event.id} className="flex items-start gap-2">
                    <Avatar member={entry.event.actor} />
                    <span>
                      {describeRequestEvent(t, entry.event)}
                      <span className="text-ink-faint">
                        {' '}
                        · {formatWhen(entry.event.createdAt, i18n.language)}
                      </span>
                    </span>
                  </li>
                ) : (
                  <li key={entry.comment.id}>
                    <article
                      aria-label={t('comments.by', {
                        author: entry.comment.author?.name ?? t('issues.someone'),
                      })}
                      className={`flex flex-col gap-1 rounded-lg border p-3 ${
                        entry.comment.internal
                          ? 'border-amber-500/50 bg-amber-500/5'
                          : 'border-line'
                      }`}
                    >
                      <header className="flex items-center gap-2 text-xs text-ink-faint">
                        <Avatar member={entry.comment.author} />
                        <span className="font-medium text-ink">
                          {entry.comment.author?.name ?? t('issues.someone')}
                        </span>
                        <span>{formatWhen(entry.comment.createdAt, i18n.language)}</span>
                        {entry.comment.internal && (
                          <span className="text-amber-700 dark:text-amber-300">
                            {t('requests.internal')}
                          </span>
                        )}
                      </header>
                      <RichEditor
                        value={entry.comment.body}
                        editable={false}
                        label={t('requests.comment')}
                        className="border-0"
                      />
                    </article>
                  </li>
                ),
              )}
            </ol>
            {(request.can.commentPublic || request.can.commentInternal) && (
              <RequestComposer
                canPublic={request.can.commentPublic}
                canInternal={request.can.commentInternal}
                onSend={(body, internal) =>
                  run(() => api.commentRequest(request.identifier, { body, internal }))
                }
              />
            )}
          </section>
        </main>

        <aside
          aria-label={t('issues.properties')}
          className="flex w-full shrink-0 flex-col gap-4 border-line p-6 text-sm md:w-72 md:border-l"
        >
          <Property label={t('requests.requester')}>
            <Avatar member={request.requester} />
            <span className="text-ink">{request.requester?.name ?? '—'}</span>
          </Property>
          <Property label={t('requests.team')}>
            <span className="text-ink">{request.targetTeam.name}</span>
          </Property>
          {request.can.act && team ? (
            <>
              <Property label={t('issues.assignee')}>
                <select
                  aria-label={t('issues.assignee')}
                  value={request.assignee?.id ?? ''}
                  onChange={(event) =>
                    void act({ action: 'assign', assigneeId: event.target.value || null })
                  }
                  className={selectClass}
                >
                  <option value="">{t('issues.noAssignee')}</option>
                  {team.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Property>
              <Property label={t('issues.priority.label')}>
                <select
                  aria-label={t('issues.priority.label')}
                  value={request.priority}
                  onChange={(event) =>
                    void act({ action: 'priority', priority: event.target.value as Priority })
                  }
                  className={selectClass}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`issues.priority.${p}`)}
                    </option>
                  ))}
                </select>
              </Property>
              <TeamActions request={request} onAct={act} />
            </>
          ) : (
            <>
              <Property label={t('issues.assignee')}>
                <Avatar member={request.assignee} />
                <span className="text-ink">{request.assignee?.name ?? t('issues.noAssignee')}</span>
              </Property>
              <Property label={t('issues.priority.label')}>
                <PriorityIcon priority={request.priority} />
                <span className="text-ink">{t(`issues.priority.${request.priority}`)}</span>
              </Property>
            </>
          )}
          <SlaClocks sla={request.slaClocks} />
          {request.can.confirm && (
            <RequesterActions
              onConfirm={() =>
                run(() => api.requesterAction(request.identifier, { action: 'confirm' }))
              }
              onReopen={(comment) =>
                run(() => api.requesterAction(request.identifier, { action: 'reopen', comment }))
              }
            />
          )}
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

type Entry =
  | { kind: 'event'; at: string; event: RequestEventView }
  | { kind: 'comment'; at: string; comment: RequestView['comments'][number] };

function timeline(request: RequestView): Entry[] {
  return [
    ...request.events
      // Approval details live in the approvals section; comments carry their own entries.
      .filter((e) => !['approval_requested', 'approval_decided'].includes(e.kind))
      .map((event) => ({ kind: 'event' as const, at: event.createdAt, event })),
    ...request.comments.map((comment) => ({
      kind: 'comment' as const,
      at: comment.createdAt,
      comment,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

export function describeRequestEvent(t: TFunction, event: RequestEventView): string {
  const actor = event.actor?.name ?? t('issues.someone');
  const to = event.data.to as string | undefined;
  switch (event.kind) {
    case 'submitted':
      return t('requests.event.submitted', { actor });
    case 'released':
      return t('requests.event.released');
    case 'issue_spawned':
    case 'issue_linked':
      return t('requests.event.issueLinked', { actor, issue: String(event.data.identifier ?? '') });
    case 'assigned':
      return t('requests.event.assigned', { actor });
    case 'priority':
      return t('requests.event.priority', {
        actor,
        priority: t(`issues.priority.${to ?? 'none'}`),
      });
    case 'resubmitted':
      return t('requests.event.resubmitted', { actor });
    case 'approval_escalated':
      return t('requests.event.escalated');
    case 'approval_timed_out':
      return t('requests.event.timedOut');
    default:
      return to
        ? t('requests.event.status', { actor, status: t(`requests.status.${to}`) })
        : t('requests.event.updated', { actor });
  }
}

function TeamActions({
  request,
  onAct,
}: {
  request: RequestView;
  onAct: (body: RequestAction) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'none' | 'decline' | 'wait' | 'resolve'>('none');
  const [text, setText] = useState('');

  async function submit(body: RequestAction) {
    if (await onAct(body)) {
      setMode('none');
      setText('');
    }
  }

  const status = request.status;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={t('requests.teamActions')}>
      <div className="flex flex-wrap gap-2">
        {status === 'open' && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => void submit({ action: 'accept' })}
          >
            {t('requests.accept')}
          </button>
        )}
        {status === 'in_progress' && (
          <button type="button" className={ghostButtonClass} onClick={() => setMode('wait')}>
            {t('requests.askRequester')}
          </button>
        )}
        {status === 'waiting_for_requester' && (
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => void submit({ action: 'resume' })}
          >
            {t('requests.resume')}
          </button>
        )}
        {(status === 'in_progress' || status === 'waiting_for_requester') && (
          <button type="button" className={buttonClass} onClick={() => setMode('resolve')}>
            {t('requests.resolve')}
          </button>
        )}
        {(status === 'open' || status === 'in_progress' || status === 'waiting_for_requester') && (
          <button
            type="button"
            className={`${ghostButtonClass} text-red-600`}
            onClick={() => setMode('decline')}
          >
            {t('requests.decline')}
          </button>
        )}
      </div>
      {mode !== 'none' && (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            aria-label={t(`requests.${mode}Comment`)}
            placeholder={t(`requests.${mode}Comment`)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={mode !== 'resolve' && !text.trim()}
              onClick={() =>
                void submit(
                  mode === 'decline'
                    ? { action: 'decline', reason: text.trim() }
                    : mode === 'wait'
                      ? { action: 'wait_for_requester', comment: text.trim() }
                      : { action: 'resolve', ...(text.trim() ? { comment: text.trim() } : {}) },
                )
              }
            >
              {t('requests.send')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setMode('none')}>
              {t('issues.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RequesterActions({
  onConfirm,
  onReopen,
}: {
  onConfirm: () => Promise<boolean>;
  onReopen: (comment: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [reopening, setReopening] = useState(false);
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={t('requests.resolvedQuestion')}>
      <p className="text-xs text-ink-muted">{t('requests.resolvedQuestion')}</p>
      <div className="flex gap-2">
        <button type="button" className={buttonClass} onClick={() => void onConfirm()}>
          {t('requests.confirm')}
        </button>
        <button type="button" className={ghostButtonClass} onClick={() => setReopening(true)}>
          {t('requests.reopen')}
        </button>
      </div>
      {reopening && (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            aria-label={t('requests.reopenComment')}
            className={inputClass}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={!text.trim()}
            onClick={() => void onReopen(text.trim())}
          >
            {t('requests.reopen')}
          </button>
        </div>
      )}
    </div>
  );
}

function LinkedIssues({
  request,
  onSpawn,
}: {
  request: RequestView;
  onSpawn: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const linked = request.linkedIssues;
  if (linked.kind === 'progress') {
    if (linked.total === 0) return null;
    return (
      <p className="text-sm text-ink-muted">
        {t('requests.workProgress', { done: linked.done, total: linked.total })}
      </p>
    );
  }
  return (
    <section aria-label={t('requests.linkedIssues')} className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{t('requests.linkedIssues')}</h2>
        {request.can.spawnIssue && (
          <button type="button" className={ghostButtonClass} onClick={() => void onSpawn()}>
            + {t('requests.createIssue')}
          </button>
        )}
      </div>
      {linked.items.map((item) => (
        <Link
          key={item.identifier}
          href={`/issue/${item.identifier}`}
          className="flex gap-2 hover:underline"
        >
          <span className="text-ink-faint">{item.identifier}</span>
          <span className={item.done ? 'text-ink-faint line-through' : 'text-ink'}>
            {item.title}
          </span>
        </Link>
      ))}
    </section>
  );
}

function RequestComposer({
  canPublic,
  canInternal,
  onSend,
}: {
  canPublic: boolean;
  canInternal: boolean;
  onSend: (body: string, internal: boolean) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState(0);
  const [internal, setInternal] = useState(!canPublic);

  async function send() {
    if (!draft.trim()) return;
    if (await onSend(draft, internal)) {
      setDraft('');
      setRound((n) => n + 1);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <RichEditor
        key={round}
        value=""
        label={t('comments.new')}
        placeholder={t('comments.placeholder')}
        onChange={setDraft}
      />
      <div className="flex items-center justify-end gap-3">
        {canInternal && canPublic && (
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            {t('requests.internalComment')}
          </label>
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={!draft.trim()}
          onClick={() => void send()}
        >
          {t('comments.send')}
        </button>
      </div>
    </div>
  );
}

function Resubmit({
  request,
  onDone,
}: {
  request: RequestView;
  onDone: (next: RequestView) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, FormValue>>(request.formData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  async function send() {
    const result = validateFormData(request.fields, values);
    if (!result.ok) return setErrors(result.errors);
    try {
      onDone(await api.resubmitRequest(request.identifier, { formData: values }));
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  return (
    <section
      aria-label={t('requests.changesRequested')}
      className="flex flex-col gap-3 rounded-lg border border-amber-500/50 p-4"
    >
      <h2 className="text-sm font-semibold text-ink">{t('requests.changesRequested')}</h2>
      <FormFields
        fields={request.fields}
        values={values}
        errors={errors}
        onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
      />
      <FormError message={error ? t(error) : undefined} />
      <div>
        <button type="button" className={buttonClass} onClick={() => void send()}>
          {t('requests.resubmit')}
        </button>
      </div>
    </section>
  );
}
