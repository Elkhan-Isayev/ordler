import { z } from 'zod';

/** How Slack reaches Ordler: an outbound WebSocket (default, no public URL) or HTTPS. */
export const SLACK_APP_MODES = ['socket', 'http'] as const;
export type SlackAppMode = (typeof SLACK_APP_MODES)[number];

const secret = (pattern: RegExp) => z.string().trim().regex(pattern).max(512).nullable().optional();

/**
 * Admin → Integrations → Slack app (SPEC §7.1, level 2). Tokens and secrets are write-only:
 * omit to keep the stored value, `null` to clear it.
 */
export const updateSlackAppSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(SLACK_APP_MODES),
  botToken: secret(/^xoxb-[\w-]+$/),
  appToken: secret(/^xapp-[\w-]+$/),
  signingSecret: secret(/^[a-f0-9]{16,128}$/),
  clientId: z
    .string()
    .trim()
    .regex(/^[0-9]+\.[0-9]+$/)
    .nullable()
    .optional(),
  clientSecret: secret(/^[a-f0-9]{16,128}$/),
});
export type UpdateSlackAppInput = z.infer<typeof updateSlackAppSchema>;

/** Response of GET /api/admin/slack-app. */
export interface SlackAppView {
  enabled: boolean;
  mode: SlackAppMode;
  /** The workspace the bot token belongs to, from `auth.test`. */
  workspace: { id: string; name: string } | null;
  botTokenSet: boolean;
  appTokenSet: boolean;
  signingSecretSet: boolean;
  clientId: string | null;
  clientSecretSet: boolean;
  /** Socket Mode connection of this replica; `http` mode is always `n/a`. */
  connection: 'connected' | 'connecting' | 'disconnected' | 'n/a';
  lastError: string | null;
  linkedMembers: number;
  /** URLs to paste into the Slack app settings. */
  urls: { redirect: string; events: string; interactivity: string };
}

/** Response of GET /api/me/slack: whether the member can link and how they are linked. */
export interface SlackLinkView {
  available: boolean;
  linked: boolean;
  workspace: string | null;
  directMessages: boolean;
}

export const updateSlackLinkSchema = z.object({ directMessages: z.boolean() });

/** Public channels for the subscription picker. */
export interface SlackChannel {
  id: string;
  name: string;
}
