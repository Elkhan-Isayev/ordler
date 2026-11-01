import { createHash } from 'node:crypto';
import {
  formatRequestIdentifier,
  isLocale,
  routeRequest,
  type InboundEmailStatus,
  type InboundEmailView,
  type InboxPollResult,
  type InboxSettingsView,
  type Locale,
  type RoutingRule,
  type UpdateInboxSettingsInput,
} from '@ordler/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { storeAttachment } from '../attachments/attachment.service.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { inboundEmails, inboxSettings, requests, requestTypes } from '../db/schema.js';
import type { MailMessage } from '../mail/mailer.js';
import { renderEmail } from '../mail/templates.js';
import { findMemberByEmail } from '../members/members.js';
import type { RequestService } from '../requests/request.service.js';
import { getInstance } from '../setup/setup.service.js';
import { imapConnector, type InboxConfig, type MailboxConnector } from './mailbox.js';

const PASSWORD_AAD = 'inbox_settings:password';
/** Per poll, so one flood cannot hold the worker for long; the rest waits for the next poll. */
const BATCH = 50;
/** Senders whose messages are bounces and must never get a reply. */
const BOUNCE_SENDERS = /^(mailer-daemon|postmaster|no-?reply)@/i;

type Row = typeof inboxSettings.$inferSelect;

export interface EmailInDeps {
  db: Db;
  box: SecretBox;
  mail: { isConfigured(): Promise<boolean>; send(message: MailMessage): Promise<void> };
  requests: Pick<RequestService, 'submit'>;
  baseUrl: string;
  attachmentMaxBytes: number;
  connector?: MailboxConnector;
  now?: () => Date;
  log?: (message: string) => void;
}

interface Outcome {
  status: InboundEmailStatus;
  reason?: string;
  requestId?: string;
}

/**
 * Email-in (SPEC §7): reads one IMAP mailbox and turns a member's message to a request type's
 * address into a request of that type, acting as that member with the same checks as the
 * portal. Each Message-ID is handled once, even with several workers polling.
 */
export class EmailInService {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly deps: EmailInDeps) {}

  async view(): Promise<InboxSettingsView> {
    const row = await this.row();
    return {
      configured: Boolean(row),
      enabled: row?.enabled ?? false,
      host: row?.host ?? null,
      port: row?.port ?? 993,
      security: row?.security ?? 'tls',
      verifyTls: row?.verifyTls ?? true,
      username: row?.username ?? null,
      passwordSet: Boolean(row?.passwordEncrypted),
      folder: row?.folder ?? 'INBOX',
      lastPollAt: row?.lastPollAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  async update(
    input: UpdateInboxSettingsInput,
    actor: AuditActor & { id: string },
  ): Promise<InboxSettingsView> {
    const before = await this.view();
    const existing = await this.row();
    const passwordEncrypted =
      input.password === undefined
        ? (existing?.passwordEncrypted ?? null)
        : input.password === null || input.password === ''
          ? null
          : this.deps.box.encrypt(input.password, PASSWORD_AAD);
    const values = {
      enabled: input.enabled,
      host: input.host,
      port: input.port,
      security: input.security,
      verifyTls: input.verifyTls,
      username: input.username,
      passwordEncrypted,
      folder: input.folder,
      lastError: null,
      updatedAt: this.now(),
      updatedBy: actor.id,
    };
    await this.deps.db
      .insert(inboxSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: inboxSettings.id, set: values });
    const after = await this.view();
    await writeAudit(this.deps.db, {
      actor,
      action: 'inbox_settings.updated',
      targetType: 'inbox_settings',
      before,
      after: { ...after, passwordChanged: input.password !== undefined },
    });
    return after;
  }

  async messages(limit = 50): Promise<InboundEmailView[]> {
    const rows = await this.deps.db
      .select({ email: inboundEmails, number: requests.number })
      .from(inboundEmails)
      .leftJoin(requests, eq(requests.id, inboundEmails.requestId))
      .orderBy(desc(inboundEmails.receivedAt))
      .limit(limit);
    return rows.map(({ email, number }) => ({
      id: email.id,
      from: email.fromAddress,
      to: email.toAddresses,
      subject: email.subject,
      status: email.status,
      reason: email.reason,
      request:
        email.requestId && number !== null
          ? { id: email.requestId, identifier: formatRequestIdentifier(number) }
          : null,
      receivedAt: email.receivedAt.toISOString(),
    }));
  }

  startRunner(intervalMs = 60_000): void {
    const loop = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        if ((await this.row())?.enabled) await this.poll();
      } catch (error) {
        this.deps.log?.(`Email-in poll failed: ${String(error)}`);
      } finally {
        this.busy = false;
      }
    };
    void loop();
    this.timer = setInterval(() => void loop(), intervalMs);
    this.timer.unref();
  }

  stopRunner(): void {
    clearInterval(this.timer);
  }

  /** Reads unread messages once; the error is kept for the admin panel. */
  async poll(): Promise<InboxPollResult> {
    const config = await this.config();
    if (!config) return { ok: false, error: 'not_configured' };
    let processed = 0;
    let failure: string | undefined;
    const session = await (this.deps.connector ?? imapConnector)(config).catch((error: unknown) => {
      failure = errorMessage(error);
      return undefined;
    });
    if (session) {
      try {
        for (const uid of await session.unread(BATCH)) {
          const message = await session.read(uid);
          if (message) await this.receive(message.source);
          await session.markRead(uid);
          processed += 1;
        }
      } catch (error) {
        failure = errorMessage(error);
      } finally {
        await session.close().catch(() => undefined);
      }
    }
    await this.deps.db
      .update(inboxSettings)
      .set({ lastPollAt: this.now(), lastError: failure ?? null })
      .where(eq(inboxSettings.id, 1));
    return failure ? { ok: false, error: failure } : { ok: true, processed };
  }

  /** Handles one raw RFC 5322 message; returns undefined when it was handled before. */
  async receive(source: Buffer): Promise<Outcome | undefined> {
    const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
    const from = mail.from?.value[0]?.address?.toLowerCase() ?? '';
    const recipients = recipientsOf(mail);
    const messageId =
      mail.messageId?.trim() || `sha256:${createHash('sha256').update(source).digest('hex')}`;
    const subject = (mail.subject ?? '').trim().slice(0, 500);

    // Claim first: a second worker, or a retry after a crash, finds the row and stops here.
    const [claimed] = await this.deps.db
      .insert(inboundEmails)
      .values({
        messageId,
        fromAddress: from,
        toAddresses: recipients,
        subject,
        status: 'failed',
        reason: 'processing',
        receivedAt: this.now(),
      })
      .onConflictDoNothing()
      .returning({ id: inboundEmails.id });
    if (!claimed) return undefined;

    let outcome: Outcome;
    try {
      outcome = await this.handle(mail, { from, recipients, subject, messageId });
    } catch (error) {
      this.deps.log?.(`Email-in could not handle ${messageId}: ${String(error)}`);
      outcome = { status: 'failed', reason: errorMessage(error).slice(0, 500) };
    }
    await this.deps.db
      .update(inboundEmails)
      .set({
        status: outcome.status,
        reason: outcome.reason ?? null,
        requestId: outcome.requestId ?? null,
      })
      .where(eq(inboundEmails.id, claimed.id));
    return outcome;
  }

  private async handle(
    mail: ParsedMail,
    envelope: { from: string; recipients: string[]; subject: string; messageId: string },
  ): Promise<Outcome> {
    if (isAutomatic(mail) || !envelope.from || BOUNCE_SENDERS.test(envelope.from)) {
      return { status: 'ignored', reason: 'automatic' };
    }
    const [type] =
      envelope.recipients.length > 0
        ? await this.deps.db
            .select()
            .from(requestTypes)
            .where(inArray(requestTypes.emailAddress, envelope.recipients))
            .limit(1)
        : [];
    if (!type) return { status: 'no_route' };

    // No reply to strangers: answering forged senders would make Ordler a spam relay.
    const member = await findMemberByEmail(this.deps.db, envelope.from);
    if (!member || member.status !== 'active') return { status: 'unknown_sender' };

    const instance = await getInstance(this.deps.db);
    const locale: Locale =
      member.locale && isLocale(member.locale)
        ? member.locale
        : instance && isLocale(instance.defaultLocale)
          ? instance.defaultLocale
          : 'en';
    const company = instance?.companyName ?? 'Ordler';
    const title = titleOf(envelope.subject, mail.text);

    let requestId: string;
    let identifier: string;
    try {
      if (type.archivedAt) throw new DomainError('request_type_archived');
      const teamId = routeRequest(
        { targetTeamId: type.targetTeamId, routingRules: type.routingRules as RoutingRule[] },
        {},
      );
      const description = await this.description(mail, teamId, member.id);
      const request = await this.deps.requests.submit(
        { memberId: member.id, tokenName: 'email' },
        {
          requestTypeId: type.id,
          title,
          description,
          priority: 'none',
          formData: {},
          extraApprovals: [],
        },
      );
      requestId = request.id;
      identifier = request.identifier;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await this.reply(envelope, locale, 'email_in_rejected', {
        company,
        title,
        reason: error.code,
        url: `${this.deps.baseUrl}/portals/new/${type.id}`,
      });
      return { status: 'rejected', reason: error.code };
    }

    await this.reply(envelope, locale, 'email_in_received', {
      company,
      item: identifier,
      title,
      url: `${this.deps.baseUrl}/requests/${identifier}`,
    });
    return { status: 'created', requestId };
  }

  /** The plain-text body, then links to the attachments stored for the receiving team. */
  private async description(mail: ParsedMail, teamId: string, memberId: string): Promise<string> {
    const body = (mail.text ?? '').trim();
    const links: string[] = [];
    const skipped: string[] = [];
    for (const attachment of mail.attachments) {
      const filename = attachment.filename ?? 'attachment';
      if (attachment.size === 0 || attachment.size > this.deps.attachmentMaxBytes) {
        skipped.push(filename);
        continue;
      }
      const stored = await storeAttachment(this.deps.db, {
        teamId,
        uploadedBy: memberId,
        file: { filename, mimetype: attachment.contentType, data: attachment.content },
      });
      links.push(`${stored.isImage ? '!' : ''}[${stored.filename}](${stored.url})`);
    }
    const parts = [body];
    if (links.length > 0) parts.push(links.map((link) => `- ${link}`).join('\n'));
    if (skipped.length > 0) parts.push(`Not attached (too large or empty): ${skipped.join(', ')}`);
    return parts.filter(Boolean).join('\n\n').slice(0, 100_000);
  }

  private async reply(
    envelope: { from: string; messageId: string },
    locale: Locale,
    template: 'email_in_received' | 'email_in_rejected',
    values: Record<string, string>,
  ): Promise<void> {
    if (!(await this.deps.mail.isConfigured())) return;
    const rendered = await renderEmail(this.deps.db, template, locale, values);
    try {
      await this.deps.mail.send({
        to: envelope.from,
        ...rendered,
        ...(envelope.messageId.startsWith('<') ? { inReplyTo: envelope.messageId } : {}),
        headers: { 'Auto-Submitted': 'auto-replied' },
      });
    } catch (error) {
      // The request exists either way; a lost confirmation is not worth a retry loop.
      this.deps.log?.(`Email-in reply to ${envelope.from} failed: ${String(error)}`);
    }
  }

  private async config(): Promise<InboxConfig | undefined> {
    const row = await this.row();
    if (!row) return undefined;
    const password = row.passwordEncrypted
      ? this.deps.box.decrypt(row.passwordEncrypted, PASSWORD_AAD)
      : undefined;
    return {
      host: row.host,
      port: row.port,
      security: row.security,
      verifyTls: row.verifyTls,
      username: row.username,
      password: password ?? '',
      folder: row.folder,
    };
  }

  private async row(): Promise<Row | undefined> {
    const [row] = await this.deps.db.select().from(inboxSettings).where(eq(inboxSettings.id, 1));
    return row;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** Every address the message was delivered to, including Bcc'd aliases seen by the server. */
function recipientsOf(mail: ParsedMail): string[] {
  const list = (value: AddressObject | AddressObject[] | undefined) =>
    (Array.isArray(value) ? value : value ? [value] : []).flatMap((group) =>
      group.value.flatMap((entry) => (entry.address ? [entry.address] : [])),
    );
  // Raw lines: these headers may repeat, and mailparser keeps only one parsed value.
  const header = (name: string) =>
    mail.headerLines
      .filter((line) => line.key === name)
      .flatMap((line) => line.line.slice(name.length + 1).match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []);
  return [
    ...new Set(
      [
        ...list(mail.to),
        ...list(mail.cc),
        ...header('delivered-to'),
        ...header('x-original-to'),
      ].map((address) => address.toLowerCase()),
    ),
  ].slice(0, 50);
}

/** Auto-replies, bounces and list mail (RFC 3834); answering them could loop forever. */
function isAutomatic(mail: ParsedMail): boolean {
  const header = (name: string) => {
    const value = mail.headers.get(name);
    return typeof value === 'string' ? value.toLowerCase().trim() : '';
  };
  const autoSubmitted = header('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(header('precedence'))) return true;
  return mail.headers.has('x-autoreply') || mail.headers.has('x-autorespond');
}

function titleOf(subject: string, text: string | undefined): string {
  const fromBody = (text ?? '').trim().split('\n')[0]?.trim() ?? '';
  return (subject || fromBody || 'Email request').slice(0, 255);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
