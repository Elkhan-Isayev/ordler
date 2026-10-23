import type { IssueSummary, TeamView, UpdateIssueInput, WorkflowStatus } from '@ordler/shared';
import { Fragment, useState, type DragEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';
import { positionBetween } from './position.js';
import { AvatarStack, LabelChip, PriorityIcon, StatusIcon, statusLabel } from './ui.js';

const DRAG_TYPE = 'application/x-ordler-issue';

/** Where a dragged card would land: a column, and the card it would sit above. */
interface DropTarget {
  statusId: string;
  beforeId: string | undefined;
}

/**
 * Kanban board (SPEC §5.4): one column per status. The card itself follows the cursor, as in
 * Trello or Linear; a line shows where it will land. Dropping on a card places it just above,
 * on empty column space puts it last. Right-click opens the issue menu.
 */
export function IssueBoard({
  team,
  issues,
  onMove,
  onAdd,
  onContextMenu,
}: {
  team: TeamView;
  issues: IssueSummary[];
  onMove: (issue: IssueSummary, patch: UpdateIssueInput) => void;
  onAdd?: ((statusId: string) => void) | undefined;
  onContextMenu?: ((issue: IssueSummary, event: MouseEvent) => void) | undefined;
}) {
  const [dragging, setDragging] = useState<string>();
  const [target, setTarget] = useState<DropTarget>();
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  function drop(status: WorkflowStatus, beforeIssueId: string | undefined, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const moved = byId.get(event.dataTransfer.getData(DRAG_TYPE) || dragging || '');
    setDragging(undefined);
    setTarget(undefined);
    if (!moved || !team.can.update) return;
    const column = issues.filter((i) => i.statusId === status.id && i.id !== moved.id);
    const index = beforeIssueId ? column.findIndex((i) => i.id === beforeIssueId) : column.length;
    const sortOrder = positionBetween(column[index - 1]?.sortOrder, column[index]?.sortOrder);
    if (moved.statusId === status.id && moved.sortOrder === sortOrder) return;
    onMove(moved, { ...(moved.statusId !== status.id ? { statusId: status.id } : {}), sortOrder });
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
      {team.statuses.map((status) => (
        <Column
          key={status.id}
          team={team}
          status={status}
          issues={issues.filter((issue) => issue.statusId === status.id)}
          dragging={dragging}
          target={target?.statusId === status.id ? target : undefined}
          onDragStart={setDragging}
          onDragEnd={() => {
            setDragging(undefined);
            setTarget(undefined);
          }}
          onTarget={setTarget}
          onDrop={drop}
          onAdd={onAdd}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

function Column({
  team,
  status,
  issues,
  dragging,
  target,
  onDragStart,
  onDragEnd,
  onTarget,
  onDrop,
  onAdd,
  onContextMenu,
}: {
  team: TeamView;
  status: WorkflowStatus;
  issues: IssueSummary[];
  dragging: string | undefined;
  target: DropTarget | undefined;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onTarget: (target: DropTarget) => void;
  onDrop: (status: WorkflowStatus, beforeIssueId: string | undefined, event: DragEvent) => void;
  onAdd?: ((statusId: string) => void) | undefined;
  onContextMenu?: ((issue: IssueSummary, event: MouseEvent) => void) | undefined;
}) {
  const { t } = useTranslation();
  const label = statusLabel(t, status);
  const line = <li aria-hidden className="h-0.5 rounded-full bg-accent" />;
  return (
    <section
      aria-label={label}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl p-2 transition-colors ${
        target ? 'bg-accent/10' : 'bg-sidebar'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        if (dragging && target?.beforeId !== undefined) return;
        if (dragging && !target) onTarget({ statusId: status.id, beforeId: undefined });
      }}
      onDrop={(event) => onDrop(status, undefined, event)}
    >
      <header className="flex items-center gap-2 px-1 text-sm">
        <StatusIcon category={status.category} />
        <h2 className="font-medium text-ink">{label}</h2>
        <span className="text-ink-faint">{issues.length}</span>
        {onAdd && team.can.create && (
          <button
            type="button"
            aria-label={t('issues.addTo', { status: label })}
            className="ml-auto rounded px-1.5 text-ink-faint hover:bg-hover hover:text-ink"
            onClick={() => onAdd(status.id)}
          >
            +
          </button>
        )}
      </header>
      <ul className="flex min-h-12 flex-col gap-2">
        {issues.map((issue) => (
          <Fragment key={issue.id}>
            {target?.beforeId === issue.id && issue.id !== dragging && line}
            <li
              draggable={team.can.update}
              className={issue.id === dragging ? 'opacity-40' : ''}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, issue.id);
                event.dataTransfer.effectAllowed = 'move';
                // The card itself follows the cursor from where it was grabbed.
                const box = event.currentTarget.getBoundingClientRect();
                event.dataTransfer.setDragImage?.(
                  event.currentTarget,
                  event.clientX - box.left,
                  event.clientY - box.top,
                );
                onDragStart(issue.id);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (dragging && target?.beforeId !== issue.id) {
                  onTarget({ statusId: status.id, beforeId: issue.id });
                }
              }}
              onDrop={(event) => onDrop(status, issue.id, event)}
              onContextMenu={(event) => {
                if (!onContextMenu) return;
                event.preventDefault();
                onContextMenu(issue, event);
              }}
            >
              <Card issue={issue} />
            </li>
          </Fragment>
        ))}
        {target && target.beforeId === undefined && dragging && line}
      </ul>
    </section>
  );
}

function Card({ issue }: { issue: IssueSummary }) {
  return (
    <Link
      href={`/issue/${issue.identifier}`}
      // The list item is dragged, not the link: browsers would otherwise drag a URL.
      draggable={false}
      className="flex cursor-grab flex-col gap-2 rounded-lg border border-line bg-card p-3 text-sm shadow-card select-none hover:border-ink-faint active:cursor-grabbing"
    >
      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>{issue.identifier}</span>
        <AvatarStack members={issue.assignees} />
      </div>
      <span className="text-ink">{issue.title}</span>
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <PriorityIcon priority={issue.priority} />
        {issue.dueDate && <span>{issue.dueDate}</span>}
        {issue.labels.map((label) => (
          <LabelChip key={label.id} label={label} />
        ))}
      </div>
    </Link>
  );
}
