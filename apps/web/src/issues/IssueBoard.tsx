import type { IssueSummary, TeamView, UpdateIssueInput, WorkflowStatus } from '@ordler/shared';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';
import { positionBetween } from './position.js';
import { Avatar, PriorityIcon, StatusIcon, statusLabel } from './ui.js';

const DRAG_TYPE = 'application/x-ordler-issue';

/**
 * Kanban board (SPEC §5.4): one column per status. Dropping a card on another card places it
 * just above; dropping on empty column space puts it last.
 */
export function IssueBoard({
  team,
  issues,
  onMove,
  onAdd,
}: {
  team: TeamView;
  issues: IssueSummary[];
  onMove: (issue: IssueSummary, patch: UpdateIssueInput) => void;
  onAdd?: ((statusId: string) => void) | undefined;
}) {
  const [dragging, setDragging] = useState<string>();
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  function drop(status: WorkflowStatus, beforeIssueId: string | undefined, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const moved = byId.get(event.dataTransfer.getData(DRAG_TYPE) || dragging || '');
    setDragging(undefined);
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
          onDragStart={setDragging}
          onDrop={drop}
          onAdd={onAdd}
        />
      ))}
    </div>
  );
}

function Column({
  team,
  status,
  issues,
  onDragStart,
  onDrop,
  onAdd,
}: {
  team: TeamView;
  status: WorkflowStatus;
  issues: IssueSummary[];
  onDragStart: (id: string) => void;
  onDrop: (status: WorkflowStatus, beforeIssueId: string | undefined, event: DragEvent) => void;
  onAdd?: ((statusId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const label = statusLabel(t, status);
  return (
    <section
      aria-label={label}
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-sidebar p-2"
      onDragOver={(event) => event.preventDefault()}
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
          <li
            key={issue.id}
            draggable={team.can.update}
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, issue.id);
              event.dataTransfer.effectAllowed = 'move';
              onDragStart(issue.id);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(status, issue.id, event)}
          >
            <Card issue={issue} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ issue }: { issue: IssueSummary }) {
  return (
    <Link
      href={`/issue/${issue.identifier}`}
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-sm shadow-xs hover:border-ink-faint"
    >
      <div className="flex items-center justify-between text-xs text-ink-faint">
        <span>{issue.identifier}</span>
        <Avatar member={issue.assignee} />
      </div>
      <span className="text-ink">{issue.title}</span>
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <PriorityIcon priority={issue.priority} />
        {issue.dueDate && <span>{issue.dueDate}</span>}
      </div>
    </Link>
  );
}
