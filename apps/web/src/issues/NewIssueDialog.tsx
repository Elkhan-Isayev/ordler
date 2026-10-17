import { PRIORITIES, type CreateIssueInput, type Priority, type TeamView } from '@ordler/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { selectClass, statusLabel } from './ui.js';

/** "New issue" form for one team; the status defaults to the column it was opened from. */
export function NewIssueDialog({
  team,
  initialStatusId,
  onCreate,
  onClose,
}: {
  team: TeamView;
  initialStatusId?: string | undefined;
  onCreate: (input: Partial<CreateIssueInput> & { title: string }) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const defaultStatus =
    initialStatusId ?? team.statuses.find((s) => s.isDefault)?.id ?? team.statuses[0]?.id;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assigneeId = String(form.get('assigneeId') ?? '');
    setBusy(true);
    const created = await onCreate({
      title: String(form.get('title')).trim(),
      description: String(form.get('description') ?? ''),
      statusId: String(form.get('statusId')),
      priority: String(form.get('priority')) as Priority,
      ...(assigneeId ? { assigneeId } : {}),
    });
    setBusy(false);
    if (created) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t('issues.newIssueIn', { team: team.name })}
        onSubmit={submit}
        className="flex w-full max-w-xl flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-xl"
      >
        <p className="text-xs text-ink-faint">{t('issues.newIssueIn', { team: team.name })}</p>
        <input
          name="title"
          required
          maxLength={255}
          autoFocus
          aria-label={t('issues.title')}
          placeholder={t('issues.title')}
          className="bg-transparent text-lg font-medium text-ink outline-none placeholder:text-ink-faint"
        />
        <textarea
          name="description"
          rows={4}
          aria-label={t('issues.description')}
          placeholder={t('issues.descriptionPlaceholder')}
          className={`${inputClass} resize-y`}
        />
        <div className="flex flex-wrap gap-2">
          <select
            name="statusId"
            defaultValue={defaultStatus}
            aria-label={t('issues.status.label')}
            className={selectClass}
          >
            {team.statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {statusLabel(t, status)}
              </option>
            ))}
          </select>
          <select
            name="priority"
            defaultValue="none"
            aria-label={t('issues.priority.label')}
            className={selectClass}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`issues.priority.${priority}`)}
              </option>
            ))}
          </select>
          {team.can.assign && (
            <select
              name="assigneeId"
              defaultValue=""
              aria-label={t('issues.assignee')}
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
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            {t('issues.cancel')}
          </button>
          <button type="submit" disabled={busy} className={buttonClass}>
            {t('issues.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
