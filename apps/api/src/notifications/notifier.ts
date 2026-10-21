import type { NotificationKind } from '@ordler/shared';

/** What happened, for whom; delivered to the Inbox and, by preference, email and Slack. */
export interface NotificationInput {
  recipients: string[];
  kind: NotificationKind;
  actorId: string | null;
  subject: { type: 'issue' | 'request' | 'request_group'; id: string };
  data?: Record<string, unknown>;
}

export interface Notifier {
  notify(input: NotificationInput): Promise<void>;
}

/** Drops notifications; tests that do not look at them use it. */
export const silentNotifier: Notifier = { notify: async () => undefined };

/** Keeps notifications in memory so tests can assert who was told what. */
export class RecordingNotifier implements Notifier {
  readonly sent: NotificationInput[] = [];

  async notify(input: NotificationInput): Promise<void> {
    if (input.recipients.length > 0) this.sent.push(input);
  }
}
