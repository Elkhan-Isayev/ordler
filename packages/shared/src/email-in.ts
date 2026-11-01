import { z } from 'zod';
import { MAIL_SECURITY_MODES, type MailSecurity } from './mail.js';

/**
 * Email-in (SPEC §7): Ordler reads one IMAP mailbox and turns messages sent to a request
 * type's address into requests. The password is write-only: omit it to keep the stored one,
 * send `null` to clear it.
 */
export const updateInboxSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  security: z.enum(MAIL_SECURITY_MODES),
  verifyTls: z.boolean(),
  username: z.string().trim().min(1).max(255),
  password: z.string().max(1024).nullable().optional(),
  folder: z.string().trim().min(1).max(200),
});
export type UpdateInboxSettingsInput = z.infer<typeof updateInboxSettingsSchema>;

/** Response of GET /api/admin/mail/inbox. */
export interface InboxSettingsView {
  configured: boolean;
  enabled: boolean;
  host: string | null;
  port: number;
  security: MailSecurity;
  verifyTls: boolean;
  username: string | null;
  passwordSet: boolean;
  folder: string;
  lastPollAt: string | null;
  lastError: string | null;
}

/** What happened to one message; every message is kept once, by Message-ID. */
export const INBOUND_EMAIL_STATUSES = [
  'created',
  'unknown_sender',
  'no_route',
  'rejected',
  'ignored',
  'failed',
] as const;
export type InboundEmailStatus = (typeof INBOUND_EMAIL_STATUSES)[number];

/** Response item of GET /api/admin/mail/inbox/messages, newest first. */
export interface InboundEmailView {
  id: string;
  from: string;
  to: string[];
  subject: string;
  status: InboundEmailStatus;
  /** Why it was not turned into a request, as an error code. */
  reason: string | null;
  request: { id: string; identifier: string } | null;
  receivedAt: string;
}

/** Response of POST /api/admin/mail/inbox/poll. */
export type InboxPollResult = { ok: true; processed: number } | { ok: false; error: string };
