import {
  ISSUE_STATUS_CATEGORIES,
  type IssueStatusCategory,
  type IssueSummary,
  type WorkflowStatus,
} from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';
import { AvatarStack, LabelChip, PriorityIcon, StatusIcon, statusLabel } from './ui.js';

interface Group {
  id: string;
  label: string;
  category: IssueStatusCategory;
  items: IssueSummary[];
}

/**
 * Issues in Linear-style rows. With a team's statuses they are grouped by status; across
 * teams (My issues) by status category. Empty groups are hidden.
 */
export function IssueList({
  statuses,
  issues,
  showTeam = false,
}: {
  statuses?: WorkflowStatus[] | undefined;
  issues: IssueSummary[];
  showTeam?: boolean;
}) {
  const { t } = useTranslation();
  const groups: Group[] = (
    statuses
      ? statuses.map((status) => ({
          id: status.id,
          label: statusLabel(t, status),
          category: status.category,
          items: issues.filter((issue) => issue.statusId === status.id),
        }))
      : ISSUE_STATUS_CATEGORIES.map((category) => ({
          id: category,
          label: t(`issues.category.${category}`),
          category,
          items: issues.filter((issue) => issue.status.category === category),
        }))
  ).filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return <p className="p-8 text-center text-sm text-ink-muted">{t('issues.empty')}</p>;
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <h2 className="flex items-center gap-2 border-b border-line bg-sidebar px-4 py-2 text-sm font-medium text-ink">
            <StatusIcon category={group.category} />
            {group.label}
            <span className="font-normal text-ink-faint">{group.items.length}</span>
          </h2>
          <ul>
            {group.items.map((issue) => (
              <li key={issue.id} className="border-b border-line">
                <Link
                  href={`/issue/${issue.identifier}`}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-hover"
                >
                  <PriorityIcon priority={issue.priority} />
                  <span className="w-20 shrink-0 text-ink-faint">{issue.identifier}</span>
                  <StatusIcon category={issue.status.category} />
                  <span className="min-w-0 flex-1 truncate text-ink">{issue.title}</span>
                  <span className="hidden gap-1 md:flex">
                    {issue.labels.map((label) => (
                      <LabelChip key={label.id} label={label} />
                    ))}
                  </span>
                  {showTeam && <span className="text-xs text-ink-faint">{issue.teamKey}</span>}
                  {issue.dueDate && <span className="text-xs text-ink-faint">{issue.dueDate}</span>}
                  <AvatarStack members={issue.assignees} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
