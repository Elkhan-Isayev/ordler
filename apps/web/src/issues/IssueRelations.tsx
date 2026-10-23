import type { IssueDetail, IssueSummary, TeamView } from '@ordler/shared';
import { GripVertical, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { Link } from '../router.js';
import { NewIssueDialog } from './NewIssueDialog.js';
import { AvatarStack, LabelChip, StatusIcon } from './ui.js';

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
  const [creating, setCreating] = useState(false);

  /** Saves positions 0..n-1 for the siblings whose position changed. */
  async function reorder(ordered: IssueSummary[]) {
    try {
      await Promise.all(
        ordered.flatMap((item, index) =>
          item.subOrder === index ? [] : [api.updateIssue(item.identifier, { subOrder: index })],
        ),
      );
      onChanged();
    } catch (failure) {
      onError(errorKey(failure));
      onChanged();
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
      <SortableSubIssues
        items={issue.children}
        label={t('issues.subIssues.title')}
        canReorder={team.can.update}
        onReorder={reorder}
        renderNested={(child) => {
          const nested = issue.grandchildren.filter((g) => g.parentId === child.id);
          // Second level, indented like Linear; deeper levels open on the sub-issue.
          return nested.length > 0 ? (
            <div className="ml-5 border-l border-line pl-2">
              <SortableSubIssues
                items={nested}
                label={child.identifier}
                canReorder={team.can.update}
                onReorder={reorder}
              />
            </div>
          ) : null;
        }}
      />
      {team.can.create && (
        <button
          type="button"
          className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-hover hover:text-ink"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden size={14} />
          {t('issues.subIssues.add')}
        </button>
      )}
      {creating && (
        <NewIssueDialog
          team={team}
          parent={{ id: issue.id, identifier: issue.identifier, title: issue.title }}
          onCreate={async (input) => {
            try {
              const created = await api.createIssue(team.key, input);
              onChanged();
              return created;
            } catch (failure) {
              onError(errorKey(failure));
              return undefined;
            }
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  );
}

function SubIssueRow({ issue }: { issue: IssueSummary }) {
  return (
    <Link
      href={`/issue/${issue.identifier}`}
      // The row is dragged to reorder, not the link.
      draggable={false}
      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-hover"
    >
      <StatusIcon category={issue.status.category} />
      <span className="w-20 shrink-0 text-ink-faint">{issue.identifier}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{issue.title}</span>
      <AvatarStack members={issue.assignees} />
    </Link>
  );
}

/** Moves `id` to sit before `beforeId` (or last); returns the new order. */
export function moveBefore<T extends { id: string }>(
  items: T[],
  id: string,
  beforeId: string | undefined,
): T[] {
  const moving = items.find((item) => item.id === id);
  if (!moving || id === beforeId) return items;
  const rest = items.filter((item) => item.id !== id);
  const index = beforeId ? rest.findIndex((item) => item.id === beforeId) : rest.length;
  return [
    ...rest.slice(0, index < 0 ? rest.length : index),
    moving,
    ...rest.slice(index < 0 ? rest.length : index),
  ];
}

/** Sub-issues of one parent; dragging a row reorders it among its siblings only. */
function SortableSubIssues({
  items,
  label,
  canReorder,
  onReorder,
  renderNested,
}: {
  items: IssueSummary[];
  label: string;
  canReorder: boolean;
  onReorder: (ordered: IssueSummary[]) => void;
  renderNested?: (item: IssueSummary) => ReactNode;
}) {
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string | null>();
  useEffect(() => setOrder(items), [items]);

  function drop(beforeId: string | undefined) {
    if (!dragging) return;
    const next = moveBefore(order, dragging, beforeId);
    setDragging(undefined);
    setOver(undefined);
    if (next.map((i) => i.id).join() === order.map((i) => i.id).join()) return;
    setOrder(next);
    onReorder(next);
  }

  return (
    <ul
      aria-label={label}
      className="flex flex-col"
      onDragOver={(event) => {
        if (!dragging) return;
        event.preventDefault();
        if (over === undefined) setOver(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        drop(undefined);
      }}
    >
      {order.map((item) => (
        <li
          key={item.id}
          draggable={canReorder}
          className={`group relative ${item.id === dragging ? 'opacity-40' : ''}`}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.identifier);
            setDragging(item.id);
          }}
          onDragEnd={() => {
            setDragging(undefined);
            setOver(undefined);
          }}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(item.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            drop(item.id);
          }}
        >
          {over === item.id && dragging !== item.id && (
            <span aria-hidden className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-accent" />
          )}
          <div className="flex items-center">
            {canReorder && (
              <GripVertical
                aria-hidden
                size={14}
                className="-ml-4 shrink-0 cursor-grab text-ink-faint opacity-0 group-hover:opacity-100"
              />
            )}
            <div className="min-w-0 flex-1">
              <SubIssueRow issue={item} />
            </div>
          </div>
          {renderNested?.(item)}
        </li>
      ))}
    </ul>
  );
}
