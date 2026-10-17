import fastifyWebsocket from '@fastify/websocket';
import {
  realtimeClientMessageSchema,
  type IssueSummary,
  type RealtimeServerMessage,
} from '@ordler/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { parseCookies } from '../http/cookies.js';
import type { OrdlerRequest } from '../http/http.js';
import type { IssueService } from '../issues/issue.service.js';
import type { SessionService } from '../auth/sessions.js';
import type { DomainEvent, EventBus } from '../realtime/event-bus.js';

export const REALTIME_PATH = '/api/realtime';
const MAX_TOPICS = 50;
const ACCESS_CACHE_MS = 30_000;
const HEARTBEAT_MS = 30_000;

export interface RealtimeDeps {
  baseUrl: string;
  issues: Pick<IssueService, 'summary' | 'permissionsForTeamId'>;
  sessions: Pick<SessionService, 'resolve'>;
  events: EventBus;
  heartbeatMs?: number;
}

interface Connection {
  socket: WebSocket;
  memberId: string;
  token: string;
  teams: Set<string>;
  /** Read access per team, re-checked at most every ACCESS_CACHE_MS. */
  access: Map<string, { read: boolean; at: number }>;
  alive: boolean;
}

/**
 * Live updates for open boards and issues (SPEC §5.4, ADR 0007). A tab subscribes to
 * `team:<id>`; every change published on the event bus reaches the tabs that may read it.
 */
export class RealtimeHub {
  private readonly connections = new Set<Connection>();
  private readonly allowedOrigin: string;
  private heartbeat: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: RealtimeDeps) {
    this.allowedOrigin = new URL(deps.baseUrl).origin;
  }

  get size(): number {
    return this.connections.size;
  }

  async register(instance: FastifyInstance): Promise<void> {
    await instance.register(fastifyWebsocket, { options: { maxPayload: 4096 } });
    instance.get(
      REALTIME_PATH,
      { websocket: true, preValidation: (request, reply) => this.authorize(request, reply) },
      (socket, request) => this.open(socket, request as OrdlerRequest),
    );
    this.unsubscribe = this.deps.events.subscribe((event) => void this.deliver(event));
    this.heartbeat = setInterval(() => void this.sweep(), this.deps.heartbeatMs ?? HEARTBEAT_MS);
    this.heartbeat.unref();
    instance.addHook('onClose', async () => this.close());
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.unsubscribe?.();
    for (const connection of this.connections) connection.socket.close(1001, 'shutdown');
    this.connections.clear();
  }

  /** Browsers always send Origin on WebSocket upgrades; other sites may not connect. */
  private async authorize(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.headers.origin !== this.allowedOrigin) {
      await reply.status(403).send({ error: 'forbidden_origin' });
      return;
    }
    if (!(request as OrdlerRequest).member) {
      await reply.status(401).send({ error: 'unauthorized' });
    }
  }

  private open(socket: WebSocket, request: OrdlerRequest): void {
    const connection: Connection = {
      socket,
      memberId: request.member!.id,
      token: parseCookies(request.headers.cookie)[SESSION_COOKIE] ?? '',
      teams: new Set(),
      access: new Map(),
      alive: true,
    };
    this.connections.add(connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('close', () => this.connections.delete(connection));
    socket.on('message', (data) => void this.receive(connection, data.toString()));
  }

  private async receive(connection: Connection, raw: string): Promise<void> {
    let message;
    try {
      message = realtimeClientMessageSchema.parse(JSON.parse(raw));
    } catch {
      connection.socket.close(1003, 'invalid message');
      return;
    }
    const teamId = /^team:([0-9a-f-]{36})$/.exec(message.topic)?.[1];
    if (message.type === 'unsubscribe') {
      if (teamId) connection.teams.delete(teamId);
      return;
    }
    if (
      !teamId ||
      connection.teams.size >= MAX_TOPICS ||
      !(await this.canRead(connection, teamId))
    ) {
      this.send(connection, { type: 'denied', topic: message.topic });
      return;
    }
    connection.teams.add(teamId);
    this.send(connection, { type: 'subscribed', topic: message.topic });
  }

  private async deliver(event: DomainEvent): Promise<void> {
    const listeners = [...this.connections].filter((c) => c.teams.has(event.teamId));
    if (listeners.length === 0) return;
    let issue: IssueSummary | undefined;
    try {
      issue = await this.deps.issues.summary(event.issueId);
    } catch {
      return;
    }
    if (!issue) return;
    for (const connection of listeners) {
      // Access is re-checked, so a removed role or team membership stops updates quickly.
      if (await this.canRead(connection, event.teamId)) {
        this.send(connection, { type: 'issue.changed', issue });
      } else {
        connection.teams.delete(event.teamId);
      }
    }
  }

  private async canRead(connection: Connection, teamId: string): Promise<boolean> {
    const cached = connection.access.get(teamId);
    const now = Date.now();
    if (cached && now - cached.at < ACCESS_CACHE_MS) return cached.read;
    const { read } = await this.deps.issues.permissionsForTeamId(connection.memberId, teamId);
    connection.access.set(teamId, { read, at: now });
    return read;
  }

  /** Drops dead sockets and sockets whose session ended (sign-out, expiry, deactivation). */
  private async sweep(): Promise<void> {
    for (const connection of this.connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        this.connections.delete(connection);
        continue;
      }
      if (!(await this.deps.sessions.resolve(connection.token))) {
        connection.socket.close(4401, 'session ended');
        this.connections.delete(connection);
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  private send(connection: Connection, message: RealtimeServerMessage): void {
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  }
}
