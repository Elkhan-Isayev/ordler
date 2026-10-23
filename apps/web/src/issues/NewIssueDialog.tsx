import {
  PRIORITIES,
  type CreateIssueInput,
  type IssueSummary,
  type Priority,
  type TeamView,
} from '@ordler/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { buttonClass, ghostButtonClass } from '../admin/common.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { RichEditor } from '../editor/RichEditor.js';
import { AssigneePicker, assigneePatch } from './AssigneePicker.js';
import { DueDatePicker } from './DueDatePicker.js';
import { PriorityIcon, selectClass, StatusIcon, statusLabel } from './ui.js';

const chipClass = `${selectClass} h-8`;

function Chip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * "New issue" (SPEC §5.4), laid out like Linear: a large title, a rich description that takes
 * pasted text, screenshots, files and diagrams, then the properties in one row. Ctrl/Cmd+Enter
 * creates; "Create more" keeps the dialog open for the next one.
 */
export function NewIssueDialog({
  team,
  initialStatusId,
  parentIssues = [],
  parent,
  onCreate,
  onClose,
}: {
  team: TeamView;
  initialStatusId?: string | undefined;
  /** Creating a sub-issue: the parent is fixed and shown instead of the parent picker. */
  parent?: { id: string; identifier: string; title: string } | undefined;
  /** Issues the new one may be filed under as a sub-issue. */
  parentIssues?: IssueSummary[];
  onCreate: (input: Partial<CreateIssueInput> & { title: string }) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const defaultStatus =
    initialStatusId ?? team.statuses.find((s) => s.isDefault)?.id ?? team.statuses[0]?.id ?? '';
  const [title, setTitle] = useState('');
  const [statusId, setStatusId] = useState(defaultStatus);
  const [priority, setPriority] = useState<Priority>('none');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [parentId, setParentId] = useState(parent?.id ?? '');
  const [createMore, setCreateMore] = useState(false);
  // Last issue created while the dialog stays open, so the person sees it worked.
  const [lastCreated, setLastCreated] = useState<string>();
  // Bumping the key gives a fresh, empty editor after "Create more".
  const [editorKey, setEditorKey] = useState(0);
  const description = useRef('');
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const created = await onCreate({
      title: title.trim(),
      description: description.current,
      statusId,
      priority,
      ...(assignees.length > 0 ? assigneePatch(team, assignees) : {}),
      ...(labelIds.length > 0 ? { labelIds } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(parentId ? { parentId } : {}),
    });
    setBusy(false);
    if (!created) return;
    if (!createMore) {
      onClose();
      return;
    }
    setLastCreated((created as { identifier?: string }).identifier ?? title.trim());
    // Keep the chosen properties, clear the text, ready for the next issue.
    setTitle('');
    description.current = '';
    setEditorKey((key) => key + 1);
    titleRef.current?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('issues.newIssueIn', { team: team.name })}
        onSubmit={submit}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-line bg-card shadow-2xl"
      >
        <header className="flex items-center gap-2 px-5 pt-4 text-xs text-ink-faint">
          <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-ink-muted">
            {team.key}
          </span>
          {parent
            ? t('issues.subIssues.newIn', { parent: parent.identifier })
            : t('issues.newIssueIn', { team: team.name })}
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
            autoFocus
            aria-label={t('issues.title')}
            placeholder={t('issues.title')}
            className="bg-transparent text-xl font-semibold text-ink outline-none placeholder:text-ink-faint"
          />
          <RichEditor
            key={editorKey}
            value=""
            label={t('issues.description')}
            placeholder={t('issues.newDescriptionPlaceholder')}
            className="min-h-40 [&_img]:max-h-80 [&_img]:w-auto"
            onChange={(markdown) => {
              description.current = markdown;
            }}
            onUpload={(file) => api.uploadAttachment(team.key, file)}
            mentionables={team.members}
            onUploadError={(failure) => setError(t(errorKey(failure)))}
          />
          <FormError message={error} />
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-3">
          <Chip label={t('issues.status.label')}>
            <StatusIcon
              category={team.statuses.find((s) => s.id === statusId)?.category ?? 'unstarted'}
            />
            <select
              value={statusId}
              onChange={(event) => setStatusId(event.target.value)}
              aria-label={t('issues.status.label')}
              className={chipClass}
            >
              {team.statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {statusLabel(t, status)}
                </option>
              ))}
            </select>
          </Chip>
          <Chip label={t('issues.priority.label')}>
            <PriorityIcon priority={priority} />
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              aria-label={t('issues.priority.label')}
              className={chipClass}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`issues.priority.${value}`)}
                </option>
              ))}
            </select>
          </Chip>
          {team.can.assign && (
            <Chip label={t('issues.assignee')}>
              <AssigneePicker
                team={team}
                value={assignees.map(
                  (id) => team.members.find((m) => m.id === id) ?? { id, name: '' },
                )}
                editable
                onChange={setAssignees}
              />
            </Chip>
          )}
          {team.labels.length > 0 && (
            <Chip label={t('issues.labels.label')}>
              <details className="relative">
                <summary className={`${chipClass} flex cursor-pointer list-none items-center`}>
                  {labelIds.length === 0
                    ? t('issues.labels.none')
                    : team.labels
                        .filter((l) => labelIds.includes(l.id))
                        .map((l) => l.name)
                        .join(', ')}
                </summary>
                <div className="absolute bottom-full left-0 z-10 mb-1 flex w-48 flex-col gap-1 rounded-lg border border-line bg-card p-2 shadow-lg">
                  {team.labels.map((label) => (
                    <label key={label.id} className="flex items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={labelIds.includes(label.id)}
                        onChange={() =>
                          setLabelIds((ids) =>
                            ids.includes(label.id)
                              ? ids.filter((id) => id !== label.id)
                              : [...ids, label.id],
                          )
                        }
                      />
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      {label.name}
                    </label>
                  ))}
                </div>
              </details>
            </Chip>
          )}
          <Chip label={t('issues.dueDate')}>
            <DueDatePicker value={dueDate || null} onChange={(next) => setDueDate(next ?? '')} />
          </Chip>
          {parent && (
            <Chip label={t('issues.subIssues.parentLabel')}>
              <span className={`${chipClass} inline-flex max-w-64 items-center truncate`}>
                {parent.identifier} {parent.title}
              </span>
            </Chip>
          )}
          {!parent && parentIssues.length > 0 && (
            <Chip label={t('issues.subIssues.parentLabel')}>
              <select
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
                aria-label={t('issues.subIssues.parentLabel')}
                className={`${chipClass} max-w-56`}
              >
                <option value="">{t('issues.subIssues.noParent')}</option>
                {parentIssues.map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {issue.identifier} {issue.title}
                  </option>
                ))}
              </select>
            </Chip>
          )}
        </div>
        <footer className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          {lastCreated ? (
            <span role="status" className="text-xs text-ink-muted">
              {t('issues.createdKeepOpen', { identifier: lastCreated })}
            </span>
          ) : (
            <span className="text-xs text-ink-faint">{t('issues.attachHint')}</span>
          )}
          <label
            title={t('issues.createMoreHint')}
            className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted"
          >
            <input
              type="checkbox"
              checked={createMore}
              onChange={(event) => setCreateMore(event.target.checked)}
            />
            {t('issues.createMore')}
          </label>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            {t('issues.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className={buttonClass}
            title="Ctrl/Cmd + Enter"
          >
            {t('issues.create')}
          </button>
        </footer>
      </form>
    </div>
  );
}
