import { z } from 'zod';
import { scopeInputSchema, type ScopeInput } from './admin.js';

/** Events an endpoint can subscribe to (SPEC §10); `ping` is only sent by "Send test". */
export const WEBHOOK_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'issue.commented',
  'request.created',
  'request.status_changed',
  'request.commented',
  'approval.requested',
  'approval.decided',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'ping';

const urlSchema = z.url({ protocol: /^https?$/ }).max(2000);

export const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: urlSchema,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  /** Which events reach it: the whole organization, one department or one team. */
  scope: scopeInputSchema.default({ type: 'organization' }),
});
export type CreateWebhookInput = z.input<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: urlSchema.optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  scope: scopeInputSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateWebhookInput = z.input<typeof updateWebhookSchema>;

export interface WebhookView {
  id: string;
  name: string;
  url: string;
  events: Array<(typeof WEBHOOK_EVENTS)[number]>;
  scope: ScopeInput;
  enabled: boolean;
  /** Deliveries that gave up in the last 7 days. */
  recentFailures: number;
  lastDeliveryAt: string | null;
  createdAt: string;
}

/** The signing secret is returned only here, once (like personal tokens). */
export interface WebhookWithSecret {
  webhook: WebhookView;
  secret: string;
}

export type WebhookDeliveryStatus = 'pending' | 'succeeded' | 'failed';

export interface WebhookDeliveryView {
  id: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
  payload: unknown;
}

/** What a receiver gets; `data` depends on the event. */
export interface WebhookEnvelope<T = unknown> {
  id: string;
  type: WebhookEvent;
  createdAt: string;
  actor: { id: string; name: string } | null;
  data: T;
}
