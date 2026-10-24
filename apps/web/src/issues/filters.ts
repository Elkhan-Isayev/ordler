import { PRIORITIES, type IssueSummary, type Priority } from '@ordler/shared';

/** Issue list filters (SPEC §5.4), serialized to the URL so a filtered view can be shared. */
export interface IssueFilters {
  status?: string;
  /** Member id, or `none` for unassigned. */
  assignee?: string;
  priority?: Priority;
  label?: string;
  /** Cycle id, or `none` for issues outside any cycle. */
  cycle?: string;
}

const KEYS = ['status', 'assignee', 'priority', 'label', 'cycle'] as const;

export function parseFilters(search: string): IssueFilters {
  const params = new URLSearchParams(search);
  const filters: IssueFilters = {};
  for (const key of KEYS) {
    const value = params.get(key);
    if (!value) continue;
    if (key === 'priority') {
      if ((PRIORITIES as readonly string[]).includes(value)) filters.priority = value as Priority;
    } else filters[key] = value;
  }
  return filters;
}

export function serializeFilters(filters: IssueFilters): string {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function applyFilters(issues: IssueSummary[], filters: IssueFilters): IssueSummary[] {
  return issues.filter(
    (issue) =>
      (!filters.status || issue.statusId === filters.status) &&
      (!filters.assignee ||
        (filters.assignee === 'none'
          ? issue.assignees.length === 0
          : issue.assignees.some((a) => a.id === filters.assignee))) &&
      (!filters.priority || issue.priority === filters.priority) &&
      (!filters.label || issue.labels.some((label) => label.id === filters.label)) &&
      (!filters.cycle ||
        (filters.cycle === 'none' ? !issue.cycleId : issue.cycleId === filters.cycle)),
  );
}

export function activeFilterCount(filters: IssueFilters): number {
  return KEYS.filter((key) => filters[key]).length;
}
