import type { MailSecurity } from '@ordler/shared';
import { ImapFlow } from 'imapflow';

export interface InboxConfig {
  host: string;
  port: number;
  security: MailSecurity;
  verifyTls: boolean;
  username: string;
  password: string;
  folder: string;
}

export interface InboxMessage {
  uid: number;
  source: Buffer;
}

/** One connection to the mailbox for one poll; swapped for an in-memory one in tests. */
export interface MailboxSession {
  /** Unread messages, oldest first, at most `limit` of them. */
  unread(limit: number): Promise<number[]>;
  read(uid: number): Promise<InboxMessage | undefined>;
  /** Marked read only after Ordler stored the outcome, so a crash means a retry, not a loss. */
  markRead(uid: number): Promise<void>;
  close(): Promise<void>;
}

export type MailboxConnector = (config: InboxConfig) => Promise<MailboxSession>;

export const imapConnector: MailboxConnector = async (config) => {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    // STARTTLS is required, not opportunistic, so a stripped capability cannot leak the password.
    doSTARTTLS:
      config.security === 'starttls' ? true : config.security === 'none' ? false : undefined,
    tls: { rejectUnauthorized: config.verifyTls },
    auth: { user: config.username, pass: config.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
  await client.connect();
  const lock = await client.getMailboxLock(config.folder);
  return {
    async unread(limit) {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      return [...uids].sort((a, b) => a - b).slice(0, limit);
    },
    async read(uid) {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      return message && message.source ? { uid, source: message.source } : undefined;
    },
    async markRead(uid) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    },
    async close() {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
};
