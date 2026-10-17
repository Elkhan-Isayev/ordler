import { z } from 'zod';
import { PRIORITIES, type IssueStatusCategory, type Priority } from './status.js';

/** Statuses every new team starts with; `key` lets the UI translate them (SPEC §5.2). */
export const DEFAULT_TEAM_STATUSES = [
  { key: 'backlog', name: 'Backlog', category: 'backlog' },
  { key: 'todo', name: 'Todo', category: 'unstarted', isDefault: true },
  { key: 'in_progress', name: 'In Progress', category: 'started' },
  { key: 'in_review', name: 'In Review', category: 'started' },
  { key: 'done', name: 'Done', category: 'completed' },
  { key: 'canceled', name: 'Canceled', category: 'canceled' },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  category: IssueStatusCategory;
  isDefault?: boolean;
}>;

const titleSchema = z.string().trim().min(1).max(255);
const descriptionSchema = z.string().max(100_000);
const dueDateSchema = z.iso.date().nullable();

export const createIssueSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  statusId: z.uuid().optional(),
  priority: z.enum(PRIORITIES).default('none'),
  assigneeId: z.uuid().nullable().default(null),
  dueDate: dueDateSchema.default(null),
});
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

/** Partial update; `sortOrder` positions the issue inside its board column. */
export const updateIssueSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    statusId: z.uuid(),
    priority: z.enum(PRIORITIES),
    assigneeId: z.uuid().nullable(),
    dueDate: dueDateSchema,
    sortOrder: z.number().finite(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'empty_update');
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const ISSUE_ERROR_CODES = [
  'forbidden',
  'status_not_in_workflow',
  'assignee_not_in_team',
] as const;
export type IssueErrorCode = (typeof ISSUE_ERROR_CODES)[number];

export interface WorkflowStatus {
  id: string;
  /** Set for the default statuses so the UI can translate them; null for custom ones. */
  key: string | null;
  name: string;
  category: IssueStatusCategory;
  position: number;
  isDefault: boolean;
}

export interface MemberRef {
  id: string;
  name: string;
}

/** Response of GET /api/teams/:key: what the board and the issue form need. */
export interface TeamView {
  id: string;
  key: string;
  name: string;
  isPrivate: boolean;
  department: { id: string; name: string };
  statuses: WorkflowStatus[];
  members: MemberRef[];
  /** What the viewer may do; the server checks every request again. */
  can: { create: boolean; update: boolean; assign: boolean };
}

export interface IssueSummary {
  id: string;
  identifier: string;
  teamId: string;
  teamKey: string;
  number: number;
  title: string;
  statusId: string;
  priority: Priority;
  assignee: MemberRef | null;
  dueDate: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type IssueField =
  'title' | 'description' | 'statusId' | 'priority' | 'assigneeId' | 'dueDate';

/** One entry of an issue's append-only history. */
export interface IssueEvent {
  id: string;
  kind: 'created' | 'updated';
  actor: MemberRef | null;
  changes: Partial<Record<IssueField, { from: unknown; to: unknown }>>;
  createdAt: string;
}

export interface IssueDetail extends IssueSummary {
  description: string;
  createdBy: MemberRef | null;
  events: IssueEvent[];
}

/** Server → browser messages on /api/realtime (SPEC §5.4, ADR 0007). */
export type RealtimeServerMessage =
  | { type: 'subscribed'; topic: string }
  | { type: 'denied'; topic: string }
  | { type: 'issue.changed'; issue: IssueSummary };

/** Browser → server messages; topics are `team:<teamId>`. */
export type RealtimeClientMessage =
  { type: 'subscribe'; topic: string } | { type: 'unsubscribe'; topic: string };

export const realtimeClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), topic: z.string().max(100) }),
  z.object({ type: z.literal('unsubscribe'), topic: z.string().max(100) }),
]);

export function teamTopic(teamId: string): string {
  return `team:${teamId}`;
}
