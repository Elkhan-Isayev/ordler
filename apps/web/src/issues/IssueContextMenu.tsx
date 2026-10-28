import {
  PRIORITIES,
  type IssueSummary,
  type TeamView,
  type UpdateIssueInput,
} from '@ordler/shared';
import { copyText } from '../components/clipboard.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cycleName } from '../cycles/format.js';
import { assigneePatch } from './AssigneePicker.js';
import { Avatar, PriorityIcon, StatusIcon, statusLabel } from './ui.js';

export interface MenuPosition {
  issue: IssueSummary;
  x: number;
  y: number;
}

type Section = 'status' | 'priority' | 'assignee' | 'labels' | 'cycle' | 'project';

const itemClass =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-hover focus:bg-hover focus:outline-none';

/**
 * Right-click menu on a card or row, like Linear: change status, priority, assignee and
 * labels in place, copy the link or ID, delete. Every action goes through the same update
 * path as the issue page, so the server still checks permissions.
 */
export function IssueContextMenu({
  menu,
  team,
  onUpdate,
  onDelete,
  onClose,
}: {
  menu: MenuPosition;
  team: TeamView;
  onUpdate: (issue: IssueSummary, patch: UpdateIssueInput) => void;
  onDelete?: ((issue: IssueSummary) => void) | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Section>();
  const ref = useRef<HTMLDivElement>(null);
  const { issue } = menu;

  useEffect(() => {
    const close = (event: Event) => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function apply(patch: UpdateIssueInput) {
    onUpdate(issue, patch);
    onClose();
  }

  const url = `${window.location.origin}/issue/${issue.identifier}`;
  const copy = (text: string) => {
    void copyText(text);
    onClose();
  };
  const assigned = issue.assignees.map((a) => a.id);
  const labels = issue.labels.map((l) => l.id);

  // Keep the menu inside the window.
  const left = Math.min(menu.x, window.innerWidth - 240);
  const top = Math.min(menu.y, window.innerHeight - 320);

  const submenu = (section: Section, label: string, children: ReactNode) => (
    <div className="relative" onMouseEnter={() => setOpen(section)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open === section}
        className={itemClass}
        // Hover already opened it; a click must not close it again.
        onClick={() => setOpen(section)}
      >
        {label}
        <span aria-hidden className="ml-auto text-ink-faint">
          ›
        </span>
      </button>
      {open === section && (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-0 left-full ml-1 max-h-72 w-52 overflow-y-auto rounded-lg border border-line bg-card p-1 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={issue.identifier}
      style={{ left, top }}
      className="fixed z-50 w-56 rounded-lg border border-line bg-card p-1 shadow-lg"
      onContextMenu={(event) => event.preventDefault()}
    >
      {team.can.update &&
        submenu(
          'status',
          t('issues.status.label'),
          team.statuses.map((status) => (
            <button
              key={status.id}
              type="button"
              role="menuitemradio"
              aria-checked={issue.statusId === status.id}
              className={itemClass}
              onClick={() => apply({ statusId: status.id })}
            >
              <StatusIcon category={status.category} />
              {statusLabel(t, status)}
            </button>
          )),
        )}
      {team.can.update &&
        submenu(
          'priority',
          t('issues.priority.label'),
          PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              role="menuitemradio"
              aria-checked={issue.priority === priority}
              className={itemClass}
              onClick={() => apply({ priority })}
            >
              <PriorityIcon priority={priority} />
              {t(`issues.priority.${priority}`)}
            </button>
          )),
        )}
      {team.can.assign &&
        submenu('assignee', t('issues.assignee'), [
          <button
            key="none"
            type="button"
            role="menuitemradio"
            aria-checked={assigned.length === 0}
            className={itemClass}
            onClick={() => apply(assigneePatch(team, []))}
          >
            <Avatar member={null} />
            {t('issues.noAssignee')}
          </button>,
          ...team.members.map((member) => (
            <button
              key={member.id}
              type="button"
              role={team.settings.multipleAssignees ? 'menuitemcheckbox' : 'menuitemradio'}
              aria-checked={assigned.includes(member.id)}
              className={itemClass}
              onClick={() =>
                apply(
                  assigneePatch(
                    team,
                    team.settings.multipleAssignees
                      ? assigned.includes(member.id)
                        ? assigned.filter((id) => id !== member.id)
                        : [...assigned, member.id]
                      : [member.id],
                  ),
                )
              }
            >
              <Avatar member={member} />
              {member.name}
            </button>
          )),
        ])}
      {team.can.update &&
        team.projects.length > 0 &&
        submenu('project', t('projects.project'), [
          <button
            key="none"
            type="button"
            role="menuitemradio"
            aria-checked={!issue.projectId}
            className={itemClass}
            onClick={() => apply({ projectId: null, milestoneId: null })}
          >
            {t('projects.noProject')}
          </button>,
          ...team.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              role="menuitemradio"
              aria-checked={issue.projectId === project.id}
              className={itemClass}
              onClick={() => apply({ projectId: project.id, milestoneId: null })}
            >
              {project.name}
            </button>
          )),
        ])}
      {team.can.update &&
        team.cycles.length > 0 &&
        submenu('cycle', t('cycles.cycle'), [
          <button
            key="none"
            type="button"
            role="menuitemradio"
            aria-checked={!issue.cycleId}
            className={itemClass}
            onClick={() => apply({ cycleId: null })}
          >
            {t('cycles.noCycle')}
          </button>,
          ...team.cycles.map((cycle) => (
            <button
              key={cycle.id}
              type="button"
              role="menuitemradio"
              aria-checked={issue.cycleId === cycle.id}
              className={itemClass}
              onClick={() => apply({ cycleId: cycle.id })}
            >
              {cycleName(t, cycle)}
            </button>
          )),
        ])}
      {team.can.update &&
        team.labels.length > 0 &&
        submenu(
          'labels',
          t('issues.labels.label'),
          team.labels.map((label) => (
            <button
              key={label.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={labels.includes(label.id)}
              className={itemClass}
              onClick={() =>
                apply({
                  labelIds: labels.includes(label.id)
                    ? labels.filter((id) => id !== label.id)
                    : [...labels, label.id],
                })
              }
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
              {labels.includes(label.id) && <span className="ml-auto text-ink-faint">✓</span>}
            </button>
          )),
        )}
      <div className="my-1 border-t border-line" />
      <button type="button" role="menuitem" className={itemClass} onClick={() => copy(url)}>
        {t('issues.menu.copyLink')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => copy(issue.identifier)}
      >
        {t('issues.menu.copyId')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          window.open(url, '_blank', 'noopener');
          onClose();
        }}
      >
        {t('issues.menu.openInNewTab')}
      </button>
      {onDelete && team.can.delete && (
        <>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-red-600 dark:text-red-400`}
            onClick={() => {
              onClose();
              if (window.confirm(t('issues.confirmDelete', { identifier: issue.identifier }))) {
                onDelete(issue);
              }
            }}
          >
            {t('issues.delete')}
          </button>
        </>
      )}
    </div>
  );
}
