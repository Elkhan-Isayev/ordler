import type {
  Locale,
  MailSettingsView,
  TestMailResult,
  UpdateMailSettingsInput,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SmtpConfig } from '../config/env.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { mailSettings } from '../db/schema.js';
import type { Mailer, MailMessage, TransportFactory } from './mailer.js';
import { renderTestEmail } from './templates.js';

type Row = typeof mailSettings.$inferSelect;

const PASSWORD_AAD = 'mail_settings:password';
/** Other replicas pick up admin changes within this window. */
const CACHE_MS = 15_000;

export interface MailServiceDeps {
  db: Db;
  box: SecretBox;
  transport: TransportFactory;
  /** SMTP_* variables; when present they win and the admin panel shows them read-only. */
  env?: SmtpConfig | undefined;
  now?: () => Date;
}

/**
 * The one mailer every feature uses (SPEC §8.2). Settings come from SMTP_* variables or, on
 * installations configured through the admin panel, from the `mail_settings` row.
 */
export class MailService implements Mailer {
  private cached?: { config: SmtpConfig | undefined; at: number };

  constructor(private readonly deps: MailServiceDeps) {}

  async isConfigured(): Promise<boolean> {
    return (await this.current()) !== undefined;
  }

  async send(message: MailMessage): Promise<void> {
    const config = await this.current();
    if (!config) throw new DomainError('mail_not_configured');
    await this.deps.transport(config).send(message);
  }

  async view(): Promise<MailSettingsView> {
    const { env } = this.deps;
    if (env) {
      return {
        source: 'env',
        host: env.host,
        port: env.port,
        security: env.security,
        verifyTls: env.verifyTls,
        username: env.user ?? null,
        passwordSet: Boolean(env.password),
        fromName: null,
        fromEmail: env.from,
      };
    }
    const row = await this.row();
    if (!row) {
      return {
        source: 'none',
        host: null,
        port: 587,
        security: 'starttls',
        verifyTls: true,
        username: null,
        passwordSet: false,
        fromName: null,
        fromEmail: null,
      };
    }
    return {
      source: 'database',
      host: row.host,
      port: row.port,
      security: row.security,
      verifyTls: row.verifyTls,
      username: row.username,
      passwordSet: row.passwordEncrypted !== null,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
    };
  }

  async update(
    input: UpdateMailSettingsInput,
    actor: AuditActor & { id: string },
  ): Promise<MailSettingsView> {
    if (this.deps.env) throw new DomainError('mail_managed_by_env');
    const before = await this.view();
    const existing = await this.row();
    const passwordEncrypted =
      input.password === undefined
        ? (existing?.passwordEncrypted ?? null)
        : input.password === null || input.password === ''
          ? null
          : this.deps.box.encrypt(input.password, PASSWORD_AAD);

    const values = {
      host: input.host,
      port: input.port,
      security: input.security,
      verifyTls: input.verifyTls,
      username: input.username || null,
      passwordEncrypted,
      fromName: input.fromName || null,
      fromEmail: input.fromEmail,
      updatedAt: this.now(),
      updatedBy: actor.id,
    };
    await this.deps.db
      .insert(mailSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: mailSettings.id, set: values });
    this.cached = undefined;

    const after = await this.view();
    await writeAudit(this.deps.db, {
      actor,
      action: 'mail_settings.updated',
      targetType: 'mail_settings',
      before,
      after: { ...after, passwordChanged: input.password !== undefined },
    });
    return after;
  }

  /** Sends a real message and reports the SMTP error verbatim, so admins can fix settings. */
  async sendTest(to: string, locale: Locale, company: string): Promise<TestMailResult> {
    const config = await this.current();
    if (!config) throw new DomainError('mail_not_configured');
    try {
      await this.deps.transport(config).send({ to, ...renderTestEmail({ locale, company }) });
      return { sent: true };
    } catch (error) {
      return { sent: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async current(): Promise<SmtpConfig | undefined> {
    if (this.deps.env) return this.deps.env;
    const at = this.now().getTime();
    if (this.cached && at - this.cached.at < CACHE_MS) return this.cached.config;
    const row = await this.row();
    const config = row ? this.toConfig(row) : undefined;
    this.cached = { config, at };
    return config;
  }

  private toConfig(row: Row): SmtpConfig {
    const password = row.passwordEncrypted
      ? this.deps.box.decrypt(row.passwordEncrypted, PASSWORD_AAD)
      : undefined;
    return {
      host: row.host,
      port: row.port,
      security: row.security,
      verifyTls: row.verifyTls,
      ...(row.username ? { user: row.username } : {}),
      ...(password ? { password } : {}),
      from: formatFrom(row.fromName, row.fromEmail),
    };
  }

  private async row(): Promise<Row | undefined> {
    const [row] = await this.deps.db.select().from(mailSettings).where(eq(mailSettings.id, 1));
    return row;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** `"Name" <email>`; quotes and backslashes in the name are escaped per RFC 5322. */
export function formatFrom(name: string | null, email: string): string {
  if (!name) return email;
  return `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" <${email}>`;
}
