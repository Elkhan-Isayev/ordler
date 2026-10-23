import type { IssueDetail, IssueSummary, TeamView, WorkflowStatus } from '@ordler/shared';

const status = (
  id: string,
  key: string,
  name: string,
  category: WorkflowStatus['category'],
  position: number,
): WorkflowStatus => ({
  id,
  key,
  name,
  category,
  position,
  isDefault: key === 'todo',
});

export const STATUSES: WorkflowStatus[] = [
  status('s-backlog', 'backlog', 'Backlog', 'backlog', 0),
  status('s-todo', 'todo', 'Todo', 'unstarted', 1),
  status('s-progress', 'in_progress', 'In Progress', 'started', 2),
  status('s-done', 'done', 'Done', 'completed', 3),
];

export const TEAM: TeamView = {
  id: '01a13d37-d040-7000-b257-0000000000aa',
  key: 'HELP',
  name: 'Helpdesk',
  isPrivate: false,
  department: { id: 'd1', name: 'IT' },
  statuses: STATUSES,
  members: [
    { id: 'm-ann', name: 'Ann Lee' },
    { id: 'm-bob', name: 'Bob Stone' },
  ],
  settings: { multipleAssignees: false },
  labels: [
    { id: 'l-bug', name: 'Bug', color: '#e5484d', scope: 'team' },
    { id: 'l-sec', name: 'Security', color: '#3e63dd', scope: 'organization' },
  ],
  can: { create: true, update: true, assign: true, comment: true, delete: true },
};

export function issue(number: number, overrides: Partial<IssueSummary> = {}): IssueSummary {
  const statusId = overrides.statusId ?? 's-todo';
  const found = STATUSES.find((s) => s.id === statusId)!;
  return {
    id: `i${number}`,
    identifier: `HELP-${number}`,
    teamId: TEAM.id,
    teamKey: 'HELP',
    number,
    title: `Issue ${number}`,
    statusId,
    status: { id: found.id, key: found.key, name: found.name, category: found.category },
    priority: 'none',
    assignee: null,
    assignees: overrides.assignee ? [overrides.assignee] : [],
    dueDate: null,
    sortOrder: -number,
    inTriage: false,
    labels: [],
    parentId: null,
    subOrder: 0,
    createdAt: '2026-10-18T09:00:00.000Z',
    updatedAt: '2026-10-18T09:00:00.000Z',
    ...overrides,
  };
}

export function detail(number: number, overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    ...issue(number),
    description: 'Screen flickers',
    parent: null,
    duplicateOf: null,
    children: [],
    grandchildren: [],
    ancestors: [],
    createdBy: { id: 'm-ann', name: 'Ann Lee' },
    comments: [],
    events: [
      {
        id: 'e1',
        kind: 'created',
        actor: { id: 'm-ann', name: 'Ann Lee' },
        changes: {},
        viaToken: null,
        createdAt: '2026-10-18T09:00:00.000Z',
      },
    ],
    ...overrides,
  };
}
