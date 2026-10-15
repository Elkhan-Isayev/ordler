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

/** SMTP delivery configured from SMTP_* variables; the admin-panel mail settings come later. */
export class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.security === 'tls',
      requireTLS: config.security === 'starttls',
      ignoreTLS: config.security === 'none',
      tls: { rejectUnauthorized: config.verifyTls },
      ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.from, ...message });
  }
}

/** Keeps sent messages in memory; used by tests and to inspect mail in development. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
