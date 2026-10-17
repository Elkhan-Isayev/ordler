import pg from 'pg';

/** Something changed that open browser tabs should see; resolved to data per subscriber. */
export interface DomainEvent {
  type: 'issue.changed';
  teamId: string;
  issueId: string;
}

export type EventHandler = (event: DomainEvent) => void;

/** Carries domain events to every replica; see ADR 0007. */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(handler: EventHandler): () => void;
}

/** Single-process bus for tests and development. */
export class LocalEventBus implements EventBus {
  private readonly handlers = new Set<EventHandler>();

  async publish(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers) handler(event);
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const EVENT_CHANNEL = 'ordler_events';

/**
 * PostgreSQL LISTEN/NOTIFY: every replica hears every event without extra infrastructure.
 * Payloads carry only ids, well under the 8000-byte NOTIFY limit.
 */
export class PgEventBus implements EventBus {
  private readonly local = new LocalEventBus();
  private listener: pg.Client | undefined;
  private stopped = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly clientConfig: pg.ClientConfig,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  async start(): Promise<void> {
    const client = new pg.Client(this.clientConfig);
    client.on('notification', (message) => {
      if (message.channel !== EVENT_CHANNEL || !message.payload) return;
      try {
        void this.local.publish(JSON.parse(message.payload) as DomainEvent);
      } catch {
        // A malformed payload is dropped; it can only come from outside Ordler.
      }
    });
    client.on('error', (error) => {
      this.log(`Realtime listener lost its connection: ${error.message}`);
      this.listener = undefined;
      // Browsers refetch on reconnect, so a short gap only delays updates.
      if (!this.stopped) setTimeout(() => void this.start().catch(() => undefined), 2000);
    });
    await client.connect();
    await client.query(`listen ${EVENT_CHANNEL}`);
    this.listener = client;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.listener?.end().catch(() => undefined);
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.pool.query('select pg_notify($1, $2)', [EVENT_CHANNEL, JSON.stringify(event)]);
  }

  subscribe(handler: EventHandler): () => void {
    return this.local.subscribe(handler);
  }
}
