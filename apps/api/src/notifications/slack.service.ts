import {
  can,
  isLocale,
  type ChatSubscriptionInput,
  type ChatSubscriptionView,
  type Locale,
  type SlackEvent,
} from '@ordler/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { chatSubscriptions, teams } from '../db/schema.js';
import { formatEmailMessage } from '../mail/templates.js';
import type { AccessContextSource } from '../rbac/permission.guard.js';
import { getInstance } from '../setup/setup.service.js';

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
}>;

/** What a channel message shows; never internal comments or private details. */
export interface ChannelItem {
  identifier: string;
  title: string;
  path: string;
  /** Status, priority, assignee… already translated. */
  context?: string[];
  excerpt?: string;
}

const AAD = 'chat_subscription:target';
const MAX_ATTEMPTS = 3;

/** Slack mrkdwn needs &, < and > escaped; everything else is plain text. */
export function escapeSlack(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Slack channel notifications through incoming webhooks (SPEC §7.1, level 1). A subscription
 * belongs to a team, so a message never shows more than that team's members may see.
 */
export class SlackService {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly deps: {
      db: Db;
      box: SecretBox;
      access: AccessContextSource;
      baseUrl: string;
      fetch?: FetchFn;
      sleep?: (ms: number) => Promise<void>;
      log?: (message: string) => void;
    },
  ) {}

  async list(memberId: string): Promise<ChatSubscriptionView[]> {
    const rows = await this.deps.db
      .select({ sub: chatSubscriptions, team: { id: teams.id, key: teams.key, name: teams.name } })
      .from(chatSubscriptions)
      .innerJoin(teams, eq(teams.id, chatSubscriptions.teamId))
      .orderBy(asc(teams.key), asc(chatSubscriptions.createdAt));
    const result: ChatSubscriptionView[] = [];
    for (const { sub, team } of rows) {
      if (await this.canManage(memberId, team.id)) result.push(this.view(sub, team));
    }
    return result;
  }

  async create(memberId: string, input: ChatSubscriptionInput): Promise<ChatSubscriptionView> {
    const [team] = await this.deps.db
      .select({ id: teams.id, key: teams.key, name: teams.name })
      .from(teams)
      .where(eq(teams.id, input.teamId));
    if (!team) throw new DomainError('not_found');
    if (!(await this.canManage(memberId, team.id))) throw new DomainError('forbidden');
    const [row] = await this.deps.db
      .insert(chatSubscriptions)
      .values({
        teamId: team.id,
        name: input.name,
        targetEncrypted: this.deps.box.encrypt(input.webhookUrl, AAD),
        events: [...new Set(input.events)],
        createdBy: memberId,
      })
      .returning();
    // The URL is a secret: the audit keeps only where it points.
    await writeAudit(this.deps.db, {
      actor: { type: 'member', id: memberId },
      action: 'chat_subscription.created',
      targetType: 'chat_subscription',
      targetId: row!.id,
      after: {
        teamId: team.id,
        name: input.name,
        host: new URL(input.webhookUrl).host,
        events: input.events,
      },
    });
    return this.view(row!, team);
  }

  async remove(memberId: string, id: string): Promise<void> {
    const sub = await this.subscription(id);
    if (!(await this.canManage(memberId, sub.teamId))) throw new DomainError('forbidden');
    // Subscriptions are configuration, not history; removing one is audited.
    await this.deps.db.delete(chatSubscriptions).where(eq(chatSubscriptions.id, id));
    await writeAudit(this.deps.db, {
      actor: { type: 'member', id: memberId },
      action: 'chat_subscription.deleted',
      targetType: 'chat_subscription',
      targetId: id,
    });
  }

  /** "Send test message" (SPEC §7.1): reports Slack's answer to the admin. */
  async test(memberId: string, id: string): Promise<{ sent: boolean; status: number }> {
    const sub = await this.subscription(id);
    if (!(await this.canManage(memberId, sub.teamId))) throw new DomainError('forbidden');
    const [team] = await this.deps.db
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.id, sub.teamId));
    const locale = await this.locale();
    const status = await this.post(this.url(sub), {
      text: formatEmailMessage(locale, 'slackTest', { team: team?.name ?? '' }),
    });
    return { sent: status >= 200 && status < 300, status };
  }

  /** Sends an event to every subscribed channel of the team, in the background. */
  publish(teamId: string, event: SlackEvent, item: ChannelItem): void {
    const job = this.deliver(teamId, event, item).catch((error: unknown) =>
      this.deps.log?.(`Slack delivery failed: ${(error as Error).message}`),
    );
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async deliver(teamId: string, event: SlackEvent, item: ChannelItem): Promise<void> {
    const subs = await this.deps.db
      .select()
      .from(chatSubscriptions)
      .where(
        and(eq(chatSubscriptions.teamId, teamId), sql`${event} = any(${chatSubscriptions.events})`),
      );
    if (subs.length === 0) return;
    const message = this.message(await this.locale(), event, item);
    await Promise.all(subs.map((sub) => this.post(this.url(sub), message)));
  }

  /** Block Kit: what happened, the item, its state and a plain link button. */
  message(locale: Locale, event: SlackEvent, item: ChannelItem) {
    const url = `${this.deps.baseUrl}${item.path}`;
    const heading = formatEmailMessage(locale, 'slackEvent', { kind: event });
    const text = `${heading}: ${item.identifier} ${item.title}`;
    return {
      text,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${escapeSlack(heading)}\n*<${url}|${escapeSlack(item.identifier)}>* ${escapeSlack(item.title)}${
              item.excerpt ? `\n>${escapeSlack(item.excerpt.slice(0, 280))}` : ''
            }`,
          },
        },
        ...(item.context?.length
          ? [
              {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: escapeSlack(item.context.join(' · ')) }],
              },
            ]
          : []),
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: formatEmailMessage(locale, 'slackOpen', {}) },
              url,
            },
          ],
        },
      ],
    };
  }

  /** POSTs with retries; Slack's 429 Retry-After is respected (SPEC §7.1). */
  private async post(url: string, body: unknown): Promise<number> {
    const fetchFn: FetchFn = this.deps.fetch ?? (fetch as unknown as FetchFn);
    const sleep = this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    let status = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let wait = attempt * 1000;
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        status = response.status;
        if (status === 429) wait = (Number(response.headers.get('retry-after')) || 1) * 1000;
      } catch {
        status = 0;
      }
      if (status >= 200 && status < 300) return status;
      // Client errors (bad or revoked webhook) will not get better by retrying.
      if (status !== 429 && status !== 0 && status < 500) return status;
      if (attempt < MAX_ATTEMPTS) await sleep(Math.min(30_000, wait));
    }
    return status;
  }

  private url(sub: typeof chatSubscriptions.$inferSelect): string {
    const url = this.deps.box.decrypt(sub.targetEncrypted, AAD);
    if (!url) throw new Error('Cannot decrypt the Slack webhook (encryption key changed?)');
    return url;
  }

  private async subscription(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [sub] = await this.deps.db
      .select()
      .from(chatSubscriptions)
      .where(eq(chatSubscriptions.id, id));
    if (!sub) throw new DomainError('not_found');
    return sub;
  }

  /** Team leads, department admins and org admins (team.update covers all of them). */
  private async canManage(memberId: string, teamId: string): Promise<boolean> {
    const loaded = await this.deps.access.load(memberId);
    return can(
      loaded.assignments,
      loaded.rolePermissions,
      'team.update',
      { type: 'team', id: teamId },
      loaded.directory,
    );
  }

  private async locale(): Promise<Locale> {
    const instance = await getInstance(this.deps.db);
    return instance && isLocale(instance.defaultLocale) ? instance.defaultLocale : 'en';
  }

  private view(
    sub: typeof chatSubscriptions.$inferSelect,
    team: { id: string; key: string; name: string },
  ): ChatSubscriptionView {
    const url = this.deps.box.decrypt(sub.targetEncrypted, AAD);
    return {
      id: sub.id,
      team,
      name: sub.name,
      host: url ? new URL(url).host : '',
      events: sub.events as SlackEvent[],
      createdAt: sub.createdAt.toISOString(),
    };
  }
}
