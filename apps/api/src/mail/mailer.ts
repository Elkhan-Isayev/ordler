import nodemailer from 'nodemailer';
import type { SmtpConfig } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Builds a mailer for one SMTP configuration; swapped for an in-memory one in tests. */
export type TransportFactory = (config: SmtpConfig) => Mailer;

export const smtpTransport: TransportFactory = (config) => {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    requireTLS: config.security === 'starttls',
    ignoreTLS: config.security === 'none',
    tls: { rejectUnauthorized: config.verifyTls },
    // Fail fast so "Send test email" reports unreachable hosts instead of hanging the request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
  });
  return {
    send: async (message) => {
      await transport.sendMail({ from: config.from, ...message });
    },
  };
};

/** Keeps sent messages in memory; used by tests and to inspect mail in development. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
