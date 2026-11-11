import { randomUUID } from 'node:crypto';
import fastifyWebsocket from '@fastify/websocket';
import {
  realtimeClientMessageSchema,
  type IssueSummary,
  type MemberRef,
  type RealtimeServerMessage,
  type WhiteboardElement,
} from '@ordler/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { parseCookies } from '../http/cookies.js';
import type { OrdlerRequest } from '../http/http.js';
import type { IssueService } from '../issues/issue.service.js';
import type { SessionService } from '../auth/sessions.js';
import type { DomainEvent, EventBus } from '../realtime/event-bus.js';
import type { WhiteboardService } from '../whiteboards/whiteboard.service.js';

export const REALTIME_PATH = '/api/realtime';
const MAX_TOPICS = 50;
const ACCESS_CACHE_MS = 30_000;
const HEARTBEAT_MS = 30_000;
/** Pointer updates a tab may send per second; the editor sends far fewer when throttled. */
const PRESENCE_PER_SECOND = 30;

export interface RealtimeDeps {
  baseUrl: string;
  issues: Pick<IssueService, 'summary' | 'permissionsForTeamId'>;
  whiteboards: Pick<WhiteboardService, 'teamOf' | 'changesAt' | 'memberRef'>;
  sessions: Pick<SessionService, 'resolve'>;
  events: EventBus;
  heartbeatMs?: number;
}

interface Connection {
  socket: WebSocket;
  /** Identifies this tab to the others on a whiteboard. */
  clientId: string;
  memberId: string;
  member?: MemberRef;
  /** Open whiteboards and the team each belongs to. */
  boards: Map<string, string>;
  presence: { second: number; count: number };
  token: string;
  teams: Set<string>;
  /** Subscribed to its own member topic (Inbox, Approvals, requests it is involved in). */
  personal: boolean;
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
      clientId: randomUUID(),
      memberId: request.member!.id,
      boards: new Map(),
      presence: { second: 0, count: 0 },
      token: parseCookies(request.headers.cookie)[SESSION_COOKIE] ?? '',
      teams: new Set(),
      personal: false,
      access: new Map(),
      alive: true,
    };
    this.connections.add(connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('close', () => {
      this.connections.delete(connection);
      for (const boardId of connection.boards.keys()) void this.leave(connection, boardId);
    });
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
    const memberId = /^member:([0-9a-f-]{36})$/.exec(message.topic)?.[1];
    const boardId = /^whiteboard:([0-9a-f-]{36})$/.exec(message.topic)?.[1];
    if (message.type === 'presence') {
      if (boardId && connection.boards.has(boardId) && this.allowPresence(connection)) {
        await this.publishPresence(connection, boardId, {
          pointer: message.pointer,
          button: message.button,
          selectedElementIds: message.selectedElementIds,
        });
      }
      return;
    }
    if (message.type === 'unsubscribe') {
      if (teamId) connection.teams.delete(teamId);
      if (memberId) connection.personal = false;
      if (boardId && connection.boards.delete(boardId)) await this.leave(connection, boardId);
      return;
    }
    if (boardId) {
      const boardTeam = await this.deps.whiteboards.teamOf(boardId);
      if (
        !boardTeam ||
        this.topicCount(connection) >= MAX_TOPICS ||
        !(await this.canRead(connection, boardTeam))
      ) {
        this.send(connection, { type: 'denied', topic: message.topic });
        return;
      }
      connection.boards.set(boardId, boardTeam);
      this.send(connection, { type: 'subscribed', topic: message.topic });
      return;
    }
    if (memberId) {
      // Only your own Inbox: nobody can listen to another member's notifications.
      if (memberId !== connection.memberId) {
        this.send(connection, { type: 'denied', topic: message.topic });
        return;
      }
      connection.personal = true;
      this.send(connection, { type: 'subscribed', topic: message.topic });
      return;
    }
    if (
      !teamId ||
      this.topicCount(connection) >= MAX_TOPICS ||
      !(await this.canRead(connection, teamId))
    ) {
      this.send(connection, { type: 'denied', topic: message.topic });
      return;
    }
    connection.teams.add(teamId);
    this.send(connection, { type: 'subscribed', topic: message.topic });
  }

  private async deliver(event: DomainEvent): Promise<void> {
    if (
      event.type === 'whiteboard.elements' ||
      event.type === 'whiteboard.changed' ||
      event.type === 'whiteboard.presence'
    ) {
      await this.deliverWhiteboard(event);
      return;
    }
    if (event.type === 'member.inbox') {
      for (const c of this.connections) {
        if (c.personal && event.memberIds.includes(c.memberId))
          this.send(c, { type: 'inbox.changed' });
      }
      return;
    }
    if (event.type === 'request.changed') {
      for (const c of this.connections) {
        const involved = c.personal && event.memberIds.includes(c.memberId);
        const team = c.teams.has(event.teamId) && (await this.canRead(c, event.teamId));
        if (involved || team)
          this.send(c, { type: 'request.changed', identifier: event.identifier });
      }
      return;
    }
    if (event.type === 'team.changed') {
      for (const c of this.connections) {
        if (c.teams.has(event.teamId) && (await this.canRead(c, event.teamId)))
          this.send(c, { type: 'team.changed', teamId: event.teamId });
      }
      return;
    }
    if (event.type === 'issue.removed') {
      for (const c of this.connections) {
        if (c.teams.has(event.teamId) && (await this.canRead(c, event.teamId)))
          this.send(c, { type: 'issue.removed', issueId: event.issueId, teamId: event.teamId });
      }
      return;
    }
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

  private async deliverWhiteboard(
    event: Extract<DomainEvent, { type: `whiteboard.${string}` }>,
  ): Promise<void> {
    const listeners = [...this.connections].filter((c) => c.boards.has(event.whiteboardId));
    if (listeners.length === 0) return;
    if (event.type === 'whiteboard.presence') {
      for (const c of listeners) {
        if (c.clientId !== event.presence.clientId) {
          this.send(c, {
            type: 'whiteboard.presence',
            whiteboardId: event.whiteboardId,
            presence: event.presence,
          });
        }
      }
      return;
    }
    let elements: WhiteboardElement[] = [];
    if (event.type === 'whiteboard.elements') {
      // Loaded once per replica and event, however many tabs have the board open.
      elements = await this.deps.whiteboards.changesAt(event.whiteboardId, event.seq);
      if (elements.length === 0) return;
    }
    for (const c of listeners) {
      if (!(await this.canRead(c, event.teamId))) {
        c.boards.delete(event.whiteboardId);
        continue;
      }
      this.send(
        c,
        event.type === 'whiteboard.elements'
          ? {
              type: 'whiteboard.elements',
              whiteboardId: event.whiteboardId,
              seq: event.seq,
              elements,
            }
          : { type: 'whiteboard.changed', whiteboardId: event.whiteboardId },
      );
    }
  }

  private async publishPresence(
    connection: Connection,
    boardId: string,
    state: {
      pointer: { x: number; y: number; tool: 'pointer' | 'laser' } | null;
      button: 'up' | 'down';
      selectedElementIds: string[];
    },
    left = false,
  ): Promise<void> {
    connection.member ??= await this.deps.whiteboards.memberRef(connection.memberId);
    await this.deps.events.publish({
      type: 'whiteboard.presence',
      whiteboardId: boardId,
      presence: {
        clientId: connection.clientId,
        member: connection.member,
        ...state,
        ...(left ? { left: true } : {}),
      },
    });
  }

  private leave(connection: Connection, boardId: string): Promise<void> {
    return this.publishPresence(
      connection,
      boardId,
      { pointer: null, button: 'up', selectedElementIds: [] },
      true,
    ).catch(() => undefined);
  }

  /** Drops pointer updates beyond the per-second budget instead of closing the socket. */
  private allowPresence(connection: Connection): boolean {
    const second = Math.floor(Date.now() / 1000);
    if (connection.presence.second !== second) connection.presence = { second, count: 0 };
    connection.presence.count += 1;
    return connection.presence.count <= PRESENCE_PER_SECOND;
  }

  private topicCount(connection: Connection): number {
    return connection.teams.size + connection.boards.size;
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
