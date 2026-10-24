import { createHmac, randomBytes } from 'node:crypto';
import {
  formatRequestIdentifier,
  type CreateWebhookInput,
  type IssueSummary,
  type ScopeInput,
  type UpdateWebhookInput,
  type WebhookDeliveryView,
  type WebhookEnvelope,
  type WebhookEvent,
  type WebhookView,
  type WebhookWithSecret,
} from '@ordler/shared';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import {
  departments,
  members,
  requests,
  requestTypes,
  teams,
  webhookDeliveries,
  webhookEndpoints,
} from '../db/schema.js';

type Endpoint = typeof webhookEndpoints.$inferSelect;
type Delivery = typeof webhookDeliveries.$inferSelect;
type RequestRow = typeof requests.$inferSelect;

export type WebhookFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number }>;

/** What domain services call; optional in their deps so tests can leave it out. */
export interface WebhookEmitter {
  issueEvent(
    type: 'issue.created' | 'issue.updated' | 'issue.deleted' | 'issue.commented',
    issue: IssueSummary,
    actorId: string | null,
    extra?: Record<string, unknown>,
  ): Promise<void>;
  requestEvent(
    type:
      | 'request.created'
      | 'request.status_changed'
      | 'request.commented'
      | 'approval.requested'
      | 'approval.decided',
    request: RequestRow,
    actorId: string | null,
    extra?: Record<string, unknown>,
  ): Promise<void>;
}

/** Waits after the 1st, 2nd … failed attempt; after the last one the delivery gives up. */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3600_000,
  6 * 3600_000,
  12 * 3600_000,
  24 * 3600_000,
];
const TIMEOUT_MS = 10_000;
const LOG_DAYS = 30;
const BATCH = 20;

const secretPurpose = (id: string) => `webhook:${id}`;

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, like Stripe, so replays can be refused. */
export function signature(secret: string, body: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * Webhooks (SPEC §10, ADR 0011). Events become delivery rows (an outbox) in the same database;
 * worker replicas send them, signed, and retry with exponential backoff.
 */
export class WebhookService implements WebhookEmitter {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    private readonly deps: {
      db: Db;
      box: SecretBox;
      baseUrl: string;
      fetch?: WebhookFetch;
      now?: () => Date;
      log?: (message: string) => void;
    },
  ) {}

  private get db(): Db {
    return this.deps.db;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async list(): Promise<WebhookView[]> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .orderBy(desc(webhookEndpoints.createdAt));
    return this.views(rows);
  }

  async create(memberId: string, input: Required<CreateWebhookInput>): Promise<WebhookWithSecret> {
    await this.assertScope(input.scope);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const id = crypto.randomUUID();
    await this.db.insert(webhookEndpoints).values({
      id,
      name: input.name,
      url: input.url,
      secretEncrypted: this.deps.box.encrypt(secret, secretPurpose(id)),
      events: input.events,
      scopeType: input.scope.type,
      scopeId: input.scope.type === 'organization' ? null : input.scope.id,
      createdBy: memberId,
    });
    await this.audit(memberId, 'webhook.created', id, {
      name: input.name,
      url: input.url,
      events: input.events,
    });
    return { webhook: await this.get(id), secret };
  }

  async update(memberId: string, id: string, input: UpdateWebhookInput): Promise<WebhookView> {
    const before = await this.row(id);
    if (input.scope) await this.assertScope(input.scope);
    await this.db
      .update(webhookEndpoints)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.scope
          ? {
              scopeType: input.scope.type,
              scopeId: input.scope.type === 'organization' ? null : input.scope.id,
            }
          : {}),
      })
      .where(eq(webhookEndpoints.id, id));
    await this.audit(memberId, 'webhook.updated', id, input, {
      name: before.name,
      url: before.url,
    });
    return this.get(id);
  }

  /** Removes the endpoint and its delivery log; pending deliveries are dropped. */
  async remove(memberId: string, id: string): Promise<void> {
    const before = await this.row(id);
    await this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    await this.audit(memberId, 'webhook.deleted', id, {}, { name: before.name, url: before.url });
  }

  async rotateSecret(memberId: string, id: string): Promise<WebhookWithSecret> {
    await this.row(id);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await this.db
      .update(webhookEndpoints)
      .set({ secretEncrypted: this.deps.box.encrypt(secret, secretPurpose(id)) })
      .where(eq(webhookEndpoints.id, id));
    await this.audit(memberId, 'webhook.secret_rotated', id, {});
    return { webhook: await this.get(id), secret };
  }

  /** Queues a `ping` so admins can check the receiver; it goes out on the next tick. */
  async test(memberId: string, id: string): Promise<WebhookDeliveryView> {
    const endpoint = await this.row(id);
    const actor = await this.actor(memberId);
    const [row] = await this.enqueue([endpoint], 'ping', actor, {
      webhook: { id, name: endpoint.name },
    });
    return this.deliveryView(row!);
  }

  async deliveries(id: string): Promise<WebhookDeliveryView[]> {
    await this.row(id);
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100);
    return rows.map((row) => this.deliveryView(row));
  }

  /** Sends a logged event again as a new delivery, with the same event id. */
  async redeliver(memberId: string, deliveryId: string): Promise<WebhookDeliveryView> {
    if (!/^[0-9a-f-]{36}$/.test(deliveryId)) throw new DomainError('not_found');
    const [old] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    if (!old) throw new DomainError('not_found');
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values({
        endpointId: old.endpointId,
        event: old.event,
        payload: old.payload,
        nextAttemptAt: this.now(),
      })
      .returning();
    await this.audit(memberId, 'webhook.redelivered', old.endpointId, { deliveryId });
    return this.deliveryView(row!);
  }

  async issueEvent(
    type: 'issue.created' | 'issue.updated' | 'issue.deleted' | 'issue.commented',
    issue: IssueSummary,
    actorId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.safely(async () => {
      const [team] = await this.db
        .select({
          id: teams.id,
          key: teams.key,
          name: teams.name,
          departmentId: teams.departmentId,
        })
        .from(teams)
        .where(eq(teams.id, issue.teamId));
      if (!team) return;
      const endpoints = await this.subscribed(type, team.id, [team.departmentId]);
      if (endpoints.length === 0) return;
      await this.enqueue(endpoints, type, await this.actor(actorId), {
        issue: {
          id: issue.id,
          identifier: issue.identifier,
          url: `${this.deps.baseUrl}/issue/${issue.identifier}`,
          title: issue.title,
          team: { id: team.id, key: team.key, name: team.name },
          status: { id: issue.status.id, name: issue.status.name, category: issue.status.category },
          priority: issue.priority,
          assignees: issue.assignees.map((a) => ({ id: a.id, name: a.name })),
          labels: issue.labels.map((l) => l.name),
          dueDate: issue.dueDate,
          parentId: issue.parentId,
          projectId: issue.projectId,
          cycleId: issue.cycleId,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        },
        ...extra,
      });
    });
  }

  async requestEvent(
    type:
      | 'request.created'
      | 'request.status_changed'
      | 'request.commented'
      | 'approval.requested'
      | 'approval.decided',
    request: RequestRow,
    actorId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.safely(async () => {
      const departmentIds = [
        request.targetDepartmentId,
        ...(request.requesterDepartmentId ? [request.requesterDepartmentId] : []),
      ];
      const endpoints = await this.subscribed(type, request.targetTeamId, departmentIds);
      if (endpoints.length === 0) return;
      const [context] = await this.db
        .select({
          type: requestTypes.name,
          team: { id: teams.id, key: teams.key, name: teams.name },
          department: { id: departments.id, name: departments.name },
        })
        .from(requests)
        .innerJoin(requestTypes, eq(requestTypes.id, requests.requestTypeId))
        .innerJoin(teams, eq(teams.id, requests.targetTeamId))
        .innerJoin(departments, eq(departments.id, requests.targetDepartmentId))
        .where(eq(requests.id, request.id));
      const identifier = formatRequestIdentifier(request.number);
      await this.enqueue(endpoints, type, await this.actor(actorId), {
        request: {
          id: request.id,
          identifier,
          url: `${this.deps.baseUrl}/requests/${identifier}`,
          title: request.title,
          status: request.status,
          priority: request.priority,
          requestType: context?.type ?? null,
          team: context?.team ?? null,
          department: context?.department ?? null,
          requester: await this.actor(request.requesterId),
          assignee: await this.actor(request.assigneeId),
          createdAt: request.createdAt.toISOString(),
          updatedAt: request.updatedAt.toISOString(),
        },
        ...extra,
      });
    });
  }

  /** Worker loop: sends due deliveries in batches while there are any. */
  startRunner(intervalMs = 5_000): void {
    const loop = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        while ((await this.tick()) === BATCH) {
          /* a full batch: more may be due */
        }
      } catch (error) {
        this.deps.log?.(`Webhook delivery failed: ${String(error)}`);
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

  /** Claims due deliveries with a lease (safe across replicas) and sends them; returns how many. */
  async tick(): Promise<number> {
    const now = this.now();
    await this.db
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.createdAt, new Date(now.getTime() - LOG_DAYS * 86_400_000)));
    const due = await this.db.execute(sql`
      update ${webhookDeliveries} set lease_until = ${new Date(now.getTime() + 2 * TIMEOUT_MS)}
      where id in (
        select id from ${webhookDeliveries}
        where status = 'pending' and next_attempt_at <= ${now}
          and (lease_until is null or lease_until < ${now})
        order by next_attempt_at, id limit ${BATCH}
        for update skip locked)
      returning id`);
    // node-postgres and PGlite shape raw results differently.
    const ids = (
      (Array.isArray(due) ? due : (due as { rows: unknown[] }).rows) as Array<{ id: string }>
    ).map((r) => r.id);
    if (ids.length === 0) return 0;
    const rows = await this.db
      .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(inArray(webhookDeliveries.id, ids));
    // In order per endpoint (ids are time-ordered UUIDv7), endpoints in parallel.
    rows.sort(
      (a, b) =>
        a.delivery.nextAttemptAt.getTime() - b.delivery.nextAttemptAt.getTime() ||
        a.delivery.id.localeCompare(b.delivery.id),
    );
    const byEndpoint = new Map<string, typeof rows>();
    for (const row of rows) {
      byEndpoint.set(row.endpoint.id, [...(byEndpoint.get(row.endpoint.id) ?? []), row]);
    }
    await Promise.all(
      [...byEndpoint.values()].map(async (list) => {
        for (const { delivery, endpoint } of list) await this.send(delivery, endpoint);
      }),
    );
    return ids.length;
  }

  private async send(delivery: Delivery, endpoint: Endpoint): Promise<void> {
    const attempts = delivery.attempts + 1;
    const secret = this.deps.box.decrypt(endpoint.secretEncrypted, secretPurpose(endpoint.id));
    let status: number | null = null;
    let error: string | null = null;
    if (!endpoint.enabled) {
      error = 'endpoint_disabled';
    } else if (!secret) {
      error = 'secret_unreadable';
    } else {
      const body = JSON.stringify(delivery.payload);
      try {
        const response = await (this.deps.fetch ?? defaultFetch)(endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Ordler-Webhooks/1',
            'ordler-event': delivery.event,
            'ordler-delivery': delivery.id,
            'ordler-signature': signature(secret, body, this.now()),
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = response.status;
        if (status < 200 || status >= 300) error = `HTTP ${status}`;
      } catch (failure) {
        error =
          (failure as Error).name === 'TimeoutError'
            ? 'timeout'
            : String((failure as Error).message ?? failure).slice(0, 300);
      }
    }
    const succeeded = error === null;
    const giveUp =
      !succeeded && (attempts > RETRY_DELAYS_MS.length || error === 'endpoint_disabled');
    await this.db
      .update(webhookDeliveries)
      .set({
        attempts,
        responseStatus: status,
        error,
        leaseUntil: null,
        status: succeeded ? 'succeeded' : giveUp ? 'failed' : 'pending',
        ...(succeeded ? { deliveredAt: this.now() } : {}),
        ...(!succeeded && !giveUp
          ? { nextAttemptAt: new Date(this.now().getTime() + RETRY_DELAYS_MS[attempts - 1]!) }
          : {}),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
  }

  /** Enabled endpoints that want this event and whose scope covers the team or department. */
  private async subscribed(
    type: WebhookEvent,
    teamId: string,
    departmentIds: string[],
  ): Promise<Endpoint[]> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.enabled, true));
    return rows.filter((row) => {
      if (!(row.events as string[]).includes(type)) return false;
      if (row.scopeType === 'organization') return true;
      if (row.scopeType === 'team') return row.scopeId === teamId;
      return departmentIds.includes(row.scopeId!);
    });
  }

  private async enqueue(
    endpoints: Endpoint[],
    type: WebhookEvent,
    actor: WebhookEnvelope['actor'],
    data: Record<string, unknown>,
  ): Promise<Delivery[]> {
    const envelope: WebhookEnvelope = {
      id: crypto.randomUUID(),
      type,
      createdAt: this.now().toISOString(),
      actor,
      data,
    };
    return this.db
      .insert(webhookDeliveries)
      .values(
        endpoints.map((e) => ({
          endpointId: e.id,
          event: type,
          payload: envelope,
          nextAttemptAt: this.now(),
        })),
      )
      .returning();
  }

  /** A broken webhook setup must never fail the user's change. */
  private async safely(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.deps.log?.(`Webhook enqueue failed: ${String(error)}`);
    }
  }

  private async actor(memberId: string | null): Promise<{ id: string; name: string } | null> {
    if (!memberId) return null;
    const [row] = await this.db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.id, memberId));
    return row ?? null;
  }

  private async assertScope(scope: ScopeInput): Promise<void> {
    if (scope.type === 'organization') return;
    const table = scope.type === 'team' ? teams : departments;
    const [row] = await this.db.select({ id: table.id }).from(table).where(eq(table.id, scope.id));
    if (!row) throw new DomainError('not_found');
  }

  private async get(id: string): Promise<WebhookView> {
    const [view] = await this.views([await this.row(id)]);
    return view!;
  }

  private async row(id: string): Promise<Endpoint> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async views(rows: Endpoint[]): Promise<WebhookView[]> {
    if (rows.length === 0) return [];
    const since = new Date(this.now().getTime() - 7 * 86_400_000);
    const stats = await this.db
      .select({
        endpointId: webhookDeliveries.endpointId,
        failures: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed')::int`,
        last: sql<string | null>`max(${webhookDeliveries.deliveredAt})`,
      })
      .from(webhookDeliveries)
      .where(
        and(
          inArray(
            webhookDeliveries.endpointId,
            rows.map((r) => r.id),
          ),
          gte(webhookDeliveries.createdAt, since),
        ),
      )
      .groupBy(webhookDeliveries.endpointId);
    return rows.map((row) => {
      const stat = stats.find((s) => s.endpointId === row.id);
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        events: row.events as WebhookView['events'],
        scope: (row.scopeType === 'organization'
          ? { type: 'organization' }
          : { type: row.scopeType, id: row.scopeId! }) as ScopeInput,
        enabled: row.enabled,
        recentFailures: stat?.failures ?? 0,
        lastDeliveryAt: stat?.last ? new Date(stat.last).toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  private deliveryView(row: Delivery): WebhookDeliveryView {
    return {
      id: row.id,
      event: row.event as WebhookEvent,
      status: row.status,
      attempts: row.attempts,
      responseStatus: row.responseStatus,
      error: row.error,
      nextAttemptAt: row.status === 'pending' ? row.nextAttemptAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      payload: row.payload,
    };
  }

  private async audit(
    memberId: string,
    action: string,
    id: string,
    after: object,
    before?: object,
  ): Promise<void> {
    await writeAudit(this.db, {
      actor: { type: 'member', id: memberId },
      action,
      targetType: 'webhook',
      targetId: id,
      after,
      ...(before ? { before } : {}),
    });
  }
}

const defaultFetch: WebhookFetch = async (url, init) => {
  // Redirects are not followed: a receiver must answer at the configured URL.
  const response = await fetch(url, { ...init, redirect: 'manual' });
  await response.body?.cancel();
  return { status: response.status };
};
