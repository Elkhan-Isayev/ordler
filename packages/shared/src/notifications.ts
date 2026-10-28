import { z } from 'zod';
import type { MemberRef } from './issues.js';

export const NOTIFICATION_KINDS = [
  'issue_assigned',
  'issue_commented',
  'issue_mentioned',
  'issue_status_changed',
  'approval_requested',
  'approval_decided',
  'request_rejected',
  'request_changes_requested',
  'request_received',
  'request_status_changed',
  'request_commented',
  'sla_at_risk',
  'sla_breached',
  'approval_reminder',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** One Inbox entry (SPEC §7). */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  subject: {
    type: 'issue' | 'request' | 'request_group';
    identifier: string;
    title: string;
    /** Path in the web app, e.g. /requests/REQ-57. */
    path: string;
  };
  actor: MemberRef | null;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

/** Sidebar badges. */
export interface InboxCounts {
  unread: number;
  approvals: number;
}

export const markNotificationsSchema = z.object({
  /** Omit to mark everything. */
  ids: z.array(z.uuid()).max(500).optional(),
  read: z.boolean().default(true),
});

// ---------------------------------------------------------------------------------------------
// Slack channel subscriptions (SPEC §7.1, level 1)
// ---------------------------------------------------------------------------------------------

export const SLACK_EVENTS = [
  'issue_created',
  'issue_status_changed',
  'issue_assigned',
  'issue_commented',
  'request_received',
  'approval_requested',
  'approval_decided',
  'request_resolved',
  'sla_at_risk',
  'sla_breached',
] as const;
export type SlackEvent = (typeof SLACK_EVENTS)[number];

export const chatSubscriptionInputSchema = z.object({
  teamId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  /** Slack incoming webhook URL; write-only. */
  webhookUrl: z.url({ protocol: /^https$/ }).max(500),
  events: z.array(z.enum(SLACK_EVENTS)).min(1),
});
export type ChatSubscriptionInput = z.infer<typeof chatSubscriptionInputSchema>;

/** The webhook URL is never returned; only its host, to recognise it. */
export interface ChatSubscriptionView {
  id: string;
  team: { id: string; key: string; name: string };
  name: string;
  host: string;
  events: SlackEvent[];
  createdAt: string;
}
