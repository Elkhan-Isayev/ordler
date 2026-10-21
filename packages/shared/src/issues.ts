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
const labelIdsSchema = z
  .array(z.uuid())
  .max(20)
  .transform((ids) => [...new Set(ids)]);

export const createIssueSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  statusId: z.uuid().optional(),
  priority: z.enum(PRIORITIES).default('none'),
  assigneeId: z.uuid().nullable().default(null),
  dueDate: dueDateSchema.default(null),
  labelIds: labelIdsSchema.default([]),
  /** Parent issue in the same team; makes this a sub-issue. */
  parentId: z.uuid().nullable().default(null),
});
/** What clients send; defaults fill the rest. */
export type CreateIssueInput = z.input<typeof createIssueSchema>;
export type CreateIssueData = z.output<typeof createIssueSchema>;

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
    labelIds: labelIdsSchema,
    parentId: z.uuid().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'empty_update');
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

/** Triage decisions (SPEC §5.2): accept into the workflow, or decline with a reason. */
export const triageActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
    statusId: z.uuid().optional(),
    assigneeId: z.uuid().nullable().optional(),
  }),
  z.object({ action: z.literal('decline'), reason: z.string().trim().min(1).max(2000) }),
]);
export type TriageAction = z.infer<typeof triageActionSchema>;

export const ISSUE_ERROR_CODES = [
  'forbidden',
  'status_not_in_workflow',
  'assignee_not_in_team',
  'not_in_triage',
  'label_not_in_team',
  'label_name_taken',
  'invalid_parent',
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

/** Hex colors only, so labels render the same everywhere. */
export const labelInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type LabelInput = z.infer<typeof labelInputSchema>;
export const createLabelSchema = labelInputSchema.extend({
  /** null: an organization label usable by every team. */
  teamId: z.uuid().nullable(),
});
export type CreateLabelInput = z.infer<typeof createLabelSchema>;

export interface LabelRef {
  id: string;
  name: string;
  color: string;
}

export interface LabelView extends LabelRef {
  scope: 'team' | 'organization';
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
  /** Team labels and organization labels, by name. */
  labels: LabelView[];
  /** What the viewer may do; the server checks every request again. */
  can: { create: boolean; update: boolean; assign: boolean; comment: boolean };
}

export interface IssueSummary {
  id: string;
  identifier: string;
  teamId: string;
  teamKey: string;
  number: number;
  title: string;
  statusId: string;
  status: Pick<WorkflowStatus, 'id' | 'key' | 'name' | 'category'>;
  priority: Priority;
  assignee: MemberRef | null;
  dueDate: string | null;
  sortOrder: number;
  /** Waiting in the team's Triage; hidden from the board and list until accepted. */
  inTriage: boolean;
  labels: LabelRef[];
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IssueField =
  | 'title'
  | 'description'
  | 'statusId'
  | 'priority'
  | 'assigneeId'
  | 'dueDate'
  | 'labelIds'
  | 'parentId'
  | 'triage';

/** One entry of an issue's append-only history. */
export interface IssueEvent {
  id: string;
  kind: 'created' | 'updated';
  actor: MemberRef | null;
  changes: Partial<Record<IssueField, { from: unknown; to: unknown }>>;
  /** Personal token name when an agent acted for the member (SPEC §10.1). */
  viaToken: string | null;
  createdAt: string;
}

export const commentBodySchema = z.object({ body: z.string().trim().min(1).max(100_000) });

export interface CommentView {
  id: string;
  author: MemberRef | null;
  /** Markdown; null once deleted, the entry stays so the thread keeps its shape. */
  body: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  deleted: boolean;
  /** For the viewer: own comments can be edited; own or any with comment.delete_any deleted. */
  canEdit: boolean;
  canDelete: boolean;
}

export interface IssueDetail extends IssueSummary {
  description: string;
  parent: { id: string; identifier: string; title: string } | null;
  /** Direct sub-issues; the UI shows two levels (SPEC §5.1). */
  children: IssueSummary[];
  createdBy: MemberRef | null;
  events: IssueEvent[];
  comments: CommentView[];
}

/** Server → browser messages on /api/realtime (SPEC §5.4, ADR 0007). */
export type RealtimeServerMessage =
  | { type: 'subscribed'; topic: string }
  | { type: 'denied'; topic: string }
  | { type: 'issue.changed'; issue: IssueSummary }
  /** Something arrived in or left the member's Inbox or Approvals. */
  | { type: 'inbox.changed' }
  /** A request the member is involved in changed; pages showing it reload. */
  | { type: 'request.changed'; identifier: string };

/** Browser → server messages; topics are `team:<teamId>` and the member's own `member:<id>`. */
export type RealtimeClientMessage =
  { type: 'subscribe'; topic: string } | { type: 'unsubscribe'; topic: string };

export const realtimeClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), topic: z.string().max(100) }),
  z.object({ type: z.literal('unsubscribe'), topic: z.string().max(100) }),
]);

export function teamTopic(teamId: string): string {
  return `team:${teamId}`;
}

export function memberTopic(memberId: string): string {
  return `member:${memberId}`;
}

/** GET /api/search */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
