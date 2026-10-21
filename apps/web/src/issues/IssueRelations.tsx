import type { IssueDetail, TeamView } from '@ordler/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { Link } from '../router.js';
import { LabelChip, StatusIcon } from './ui.js';

/** Palette for new labels; the next unused color keeps neighbours distinguishable. */
export const LABEL_COLORS = [
  '#e5484d',
  '#f76b15',
  '#ffc53d',
  '#30a46c',
  '#12a594',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
];

export function nextLabelColor(team: TeamView): string {
  const used = new Set(team.labels.map((l) => l.color));
  return (
    LABEL_COLORS.find((c) => !used.has(c)) ??
    LABEL_COLORS[team.labels.length % LABEL_COLORS.length]!
  );
}

/** Shows the issue's labels; editors toggle team labels or create a new one inline. */
export function LabelPicker({
  issue,
  team,
  editable,
  onSave,
  onTeamChanged,
  onError,
}: {
  issue: IssueDetail;
  team: TeamView;
  editable: boolean;
  onSave: (labelIds: string[]) => Promise<void>;
  onTeamChanged: () => void;
  onError: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const current = issue.labels.map((l) => l.id);

  function toggle(id: string) {
    void onSave(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const label = await api.createLabel({
        teamId: team.id,
        name: name.trim(),
        color: nextLabelColor(team),
      });
      setName('');
      await onSave([...current, label.id]);
      onTeamChanged();
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {issue.labels.length === 0 && <span className="text-ink-faint">—</span>}
        {issue.labels.map((label) => (
          <LabelChip key={label.id} label={label} />
        ))}
      </div>
      {editable && (
        <details>
          <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink">
            {t('issues.labels.edit')}
          </summary>
          <div className="mt-1 flex flex-col gap-1">
            {team.labels.map((label) => (
              <label key={label.id} className="flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={current.includes(label.id)}
                  onChange={() => toggle(label.id)}
                />
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </label>
            ))}
            <form onSubmit={(event) => void create(event)} className="flex gap-1">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                placeholder={t('issues.labels.newPlaceholder')}
                aria-label={t('issues.labels.new')}
                className={`${inputClass} w-full py-1 text-xs`}
              />
            </form>
          </div>
        </details>
      )}
    </div>
  );
}

/** Parent link and sub-issues (SPEC §5.1: the UI shows two levels). */
export function IssueRelations({
  issue,
  team,
  onChanged,
  onError,
}: {
  issue: IssueDetail;
  team: TeamView;
  onChanged: () => void;
  onError: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');

  async function addSubIssue(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await api.createIssue(team.key, { title: title.trim(), parentId: issue.id });
      setTitle('');
      onChanged();
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  async function detach() {
    try {
      await api.updateIssue(issue.identifier, { parentId: null });
      onChanged();
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  return (
    <section aria-label={t('issues.subIssues.title')} className="flex flex-col gap-2">
      {issue.duplicateOf && (
        <p className="text-sm text-ink-muted">
          {t('issues.duplicateOf')}{' '}
          <Link
            href={`/issue/${issue.duplicateOf.identifier}`}
            className="text-ink hover:underline"
          >
            {issue.duplicateOf.identifier} {issue.duplicateOf.title}
          </Link>
        </p>
      )}
      {issue.parent && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          {t('issues.subIssues.parent')}{' '}
          <Link href={`/issue/${issue.parent.identifier}`} className="text-ink hover:underline">
            {issue.parent.identifier} {issue.parent.title}
          </Link>
          {team.can.update && (
            <button type="button" className={ghostButtonClass} onClick={() => void detach()}>
              {t('issues.subIssues.detach')}
            </button>
          )}
        </p>
      )}
      {(issue.children.length > 0 || team.can.create) && (
        <h2 className="text-sm font-semibold text-ink">
          {t('issues.subIssues.title')}
          {issue.children.length > 0 && (
            <span className="ml-2 font-normal text-ink-faint">
              {issue.children.filter((c) => c.status.category === 'completed').length}/
              {issue.children.length}
            </span>
          )}
        </h2>
      )}
      <ul className="flex flex-col">
        {issue.children.map((child) => (
          <li key={child.id}>
            <Link
              href={`/issue/${child.identifier}`}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-hover"
            >
              <StatusIcon category={child.status.category} />
              <span className="w-20 shrink-0 text-ink-faint">{child.identifier}</span>
              <span className="truncate text-ink">{child.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      {team.can.create && (
        <form onSubmit={(event) => void addSubIssue(event)}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={255}
            placeholder={t('issues.subIssues.addPlaceholder')}
            aria-label={t('issues.subIssues.add')}
            className={`${inputClass} w-full`}
          />
        </form>
      )}
    </section>
  );
}
