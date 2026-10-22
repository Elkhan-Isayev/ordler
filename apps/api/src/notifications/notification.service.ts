import {
  formatGroupIdentifier,
  formatIssueIdentifier,
  formatRequestIdentifier,
  isLocale,
  type InboxCounts,
  type NotificationKind,
  type NotificationView,
} from '@ordler/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  approvalDecisions,
  approvalSteps,
  issues,
  members,
  notifications,
  requestGroups,
  requests,
  teams,
} from '../db/schema.js';
import type { MailService } from '../mail/mail.service.js';
import { renderNotificationEmail } from '../mail/templates.js';
import type { EventBus } from '../realtime/event-bus.js';
import { getInstance } from '../setup/setup.service.js';
import type { NotificationInput, Notifier } from './notifier.js';

/** Events worth an email; the rest stay in the Inbox. */
export const EMAILED_KINDS: ReadonlySet<NotificationKind> = new Set([
  'issue_assigned',
  'issue_mentioned',
  'approval_requested',
  'request_rejected',
  'request_changes_requested',
  'request_received',
  'request_status_changed',
]);

interface Subject {
  identifier: string;
  title: string;
  path: string;
}

export interface NotificationServiceDeps {
  db: Db;
  mail: Pick<MailService, 'isConfigured' | 'send'>;
  events: EventBus;
  baseUrl: string;
  log?: (message: string) => void;
}

/**
 * Inbox and email notifications (SPEC §7). Rows are written in the request that caused them;
 * emails go out in the background so a slow SMTP server never delays the user.
 */
export class NotificationService implements Notifier {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: NotificationServiceDeps) {}

  async notify(input: NotificationInput): Promise<void> {
    const ids = [...new Set(input.recipients)].filter((id) => id && id !== input.actorId);
    if (ids.length === 0) return;
    const active = await this.deps.db
      .select({ id: members.id })
      .from(members)
      .where(and(inArray(members.id, ids), eq(members.status, 'active')));
    const recipients = active.map((m) => m.id);
    if (recipients.length === 0) return;

    await this.deps.db.insert(notifications).values(
      recipients.map((memberId) => ({
        memberId,
        kind: input.kind,
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        actorId: input.actorId,
        data: input.data ?? {},
      })),
    );
    await this.deps.events.publish({ type: 'member.inbox', memberIds: recipients });

    if (EMAILED_KINDS.has(input.kind)) {
      const job = this.email(recipients, input).catch((error: unknown) =>
        this.deps.log?.(`Notification email failed: ${(error as Error).message}`),
      );
      this.pending.add(job);
      void job.finally(() => this.pending.delete(job));
    }
  }

  /** Waits for background emails; used by tests and graceful shutdown. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async list(memberId: string, limit = 100): Promise<NotificationView[]> {
    const rows = await this.deps.db
      .select({ n: notifications, actorName: members.name })
      .from(notifications)
      .leftJoin(members, eq(members.id, notifications.actorId))
      .where(eq(notifications.memberId, memberId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit);
    const subjects = await this.subjects(rows.map((r) => r.n));
    return rows.flatMap(({ n, actorName }) => {
      const subject = subjects.get(n.subjectId);
      if (!subject) return [];
      return [
        {
          id: n.id,
          kind: n.kind as NotificationKind,
          subject: { type: n.subjectType, ...subject },
          actor: n.actorId ? { id: n.actorId, name: actorName ?? '' } : null,
          data: n.data as Record<string, unknown>,
          read: n.readAt !== null,
          createdAt: n.createdAt.toISOString(),
        },
      ];
    });
  }

  async counts(memberId: string): Promise<InboxCounts> {
    const [unread] = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt)));
    // Active steps where the member is an approver and has not decided since activation.
    const [approvals] = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.status, 'active'),
          sql`${memberId}::uuid = any(${approvalSteps.resolvedApproverIds})`,
          sql`not exists (select 1 from ${approvalDecisions} d where d.step_id = ${approvalSteps.id}
                and d.approver_id = ${memberId}::uuid and d.created_at >= ${approvalSteps.activatedAt})`,
        ),
      );
    return { unread: unread?.count ?? 0, approvals: approvals?.count ?? 0 };
  }

  async mark(memberId: string, ids: string[] | undefined, read: boolean): Promise<InboxCounts> {
    if (ids?.length === 0) return this.counts(memberId);
    await this.deps.db
      .update(notifications)
      .set({ readAt: read ? new Date() : null })
      .where(
        and(eq(notifications.memberId, memberId), ...(ids ? [inArray(notifications.id, ids)] : [])),
      );
    await this.deps.events.publish({ type: 'member.inbox', memberIds: [memberId] });
    return this.counts(memberId);
  }

  private async email(recipients: string[], input: NotificationInput): Promise<void> {
    if (!(await this.deps.mail.isConfigured())) return;
    const subject = (
      await this.subjects([{ subjectType: input.subject.type, subjectId: input.subject.id }])
    ).get(input.subject.id);
    if (!subject) return;
    const instance = await getInstance(this.deps.db);
    const people = await this.deps.db
      .select({ id: members.id, email: members.email, locale: members.locale })
      .from(members)
      .where(inArray(members.id, [...recipients, ...(input.actorId ? [input.actorId] : [])]));
    const actor = input.actorId
      ? (
          await this.deps.db
            .select({ name: members.name })
            .from(members)
            .where(eq(members.id, input.actorId))
        )[0]?.name
      : undefined;
    for (const person of people.filter((p) => recipients.includes(p.id))) {
      const locale = isLocale(person.locale ?? '')
        ? (person.locale as 'en')
        : instance && isLocale(instance.defaultLocale)
          ? instance.defaultLocale
          : 'en';
      // Only a deep link: approvals and replies need a signed-in session (SPEC §6.3).
      await this.deps.mail.send({
        to: person.email,
        ...renderNotificationEmail({
          locale,
          company: instance?.companyName ?? 'Ordler',
          kind: input.kind,
          actor: actor ?? 'Ordler',
          item: subject.identifier,
          title: subject.title,
          url: `${this.deps.baseUrl}${subject.path}`,
        }),
      });
    }
  }

  private async subjects(
    rows: Array<{ subjectType: string; subjectId: string }>,
  ): Promise<Map<string, Subject>> {
    const map = new Map<string, Subject>();
    const ids = (type: string) => [
      ...new Set(rows.filter((r) => r.subjectType === type).map((r) => r.subjectId)),
    ];
    const issueIds = ids('issue');
    if (issueIds.length) {
      const found = await this.deps.db
        .select({ id: issues.id, number: issues.number, title: issues.title, key: teams.key })
        .from(issues)
        .innerJoin(teams, eq(teams.id, issues.teamId))
        .where(inArray(issues.id, issueIds));
      for (const i of found) {
        const identifier = formatIssueIdentifier(i.key, i.number);
        map.set(i.id, { identifier, title: i.title, path: `/issue/${identifier}` });
      }
    }
    const requestIds = ids('request');
    if (requestIds.length) {
      const found = await this.deps.db
        .select({ id: requests.id, number: requests.number, title: requests.title })
        .from(requests)
        .where(inArray(requests.id, requestIds));
      for (const r of found) {
        const identifier = formatRequestIdentifier(r.number);
        map.set(r.id, { identifier, title: r.title, path: `/requests/${identifier}` });
      }
    }
    const groupIds = ids('request_group');
    if (groupIds.length) {
      const found = await this.deps.db
        .select({ id: requestGroups.id, number: requestGroups.number, title: requestGroups.title })
        .from(requestGroups)
        .where(inArray(requestGroups.id, groupIds));
      for (const g of found) {
        const identifier = formatGroupIdentifier(g.number);
        map.set(g.id, { identifier, title: g.title, path: `/request-groups/${identifier}` });
      }
    }
    return map;
  }
}
