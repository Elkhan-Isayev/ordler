import { z } from 'zod';
import { emailSchema } from './auth.js';

export const MAIL_SECURITY_MODES = ['none', 'starttls', 'tls'] as const;
export type MailSecurity = (typeof MAIL_SECURITY_MODES)[number];

/**
 * Admin → Mail server (SPEC §8.2). The password is write-only: omit it to keep the stored one,
 * send `null` to clear it.
 */
export const updateMailSettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  security: z.enum(MAIL_SECURITY_MODES),
  verifyTls: z.boolean(),
  username: z.string().trim().max(255).nullable(),
  password: z.string().max(1024).nullable().optional(),
  fromName: z.string().trim().max(120).nullable(),
  fromEmail: emailSchema,
});
export type UpdateMailSettingsInput = z.infer<typeof updateMailSettingsSchema>;

export const sendTestMailSchema = z.object({ to: emailSchema });

/** Response of GET /api/admin/mail. Values set through SMTP_* variables are read-only. */
export interface MailSettingsView {
  source: 'env' | 'database' | 'none';
  host: string | null;
  port: number;
  security: MailSecurity;
  verifyTls: boolean;
  username: string | null;
  passwordSet: boolean;
  fromName: string | null;
  fromEmail: string | null;
}

/** Response of POST /api/admin/mail/test: the SMTP error is shown to the admin as is. */
export type TestMailResult = { sent: true } | { sent: false; error: string };
