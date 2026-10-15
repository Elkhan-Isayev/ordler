/** Fixed semantic buckets every workflow status maps to (SPEC §2). */
export const ISSUE_STATUS_CATEGORIES = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
] as const;

export const REQUEST_STATUS_CATEGORIES = [
  ...ISSUE_STATUS_CATEGORIES,
  'pending_approval',
  'waiting_for_requester',
] as const;

export type IssueStatusCategory = (typeof ISSUE_STATUS_CATEGORIES)[number];
export type RequestStatusCategory = (typeof REQUEST_STATUS_CATEGORIES)[number];

export const PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Terminal categories close an item; reopening moves it back to an active category. */
export function isTerminalCategory(category: RequestStatusCategory): boolean {
  return category === 'completed' || category === 'canceled';
}
