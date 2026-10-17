import type { RealtimeClientMessage, RealtimeServerMessage } from '@ordler/shared';
import { useEffect, useRef } from 'react';

type Listener = (message: RealtimeServerMessage) => void;

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;
const MAX_BACKOFF_MS = 15_000;

/**
 * One WebSocket per tab (ADR 0007). Topics are reference-counted across components, re-sent
 * after every reconnect, and `onReconnect` listeners refetch whatever they missed meanwhile.
 */
export class RealtimeClient {
  private socket: SocketLike | undefined;
  private readonly topics = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private readonly reconnectListeners = new Set<() => void>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private everConnected = false;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly createSocket: SocketFactory = (target) => new WebSocket(target) as SocketLike,
    private readonly schedule: (
      fn: () => void,
      ms: number,
    ) => ReturnType<typeof setTimeout> = setTimeout,
  ) {}

  subscribe(topic: string, listener: Listener, onReconnect?: () => void): () => void {
    this.listeners.add(listener);
    if (onReconnect) this.reconnectListeners.add(onReconnect);
    const count = this.topics.get(topic) ?? 0;
    this.topics.set(topic, count + 1);
    if (count === 0) this.send({ type: 'subscribe', topic });
    this.ensureConnected();

    return () => {
      this.listeners.delete(listener);
      if (onReconnect) this.reconnectListeners.delete(onReconnect);
      const left = (this.topics.get(topic) ?? 1) - 1;
      if (left > 0) {
        this.topics.set(topic, left);
      } else {
        this.topics.delete(topic);
        this.send({ type: 'unsubscribe', topic });
      }
    };
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }

  private ensureConnected(): void {
    if (this.socket || this.stopped) return;
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      for (const topic of this.topics.keys()) this.send({ type: 'subscribe', topic });
      // The first connection has nothing to catch up on; later ones may have missed events.
      if (this.everConnected) for (const refetch of this.reconnectListeners) refetch();
      this.everConnected = true;
    };
    socket.onmessage = (event) => {
      let message: RealtimeServerMessage;
      try {
        message = JSON.parse(event.data) as RealtimeServerMessage;
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(message);
    };
    socket.onclose = () => {
      this.socket = undefined;
      if (this.stopped || this.topics.size === 0) return;
      // Exponential backoff with jitter, so a restarted server is not stampeded.
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
      this.attempt += 1;
      this.timer = this.schedule(() => this.ensureConnected(), delay);
    };
  }

  private send(message: RealtimeClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }
}

let shared: RealtimeClient | undefined;

/** The tab's client, connecting to the same origin as the page. */
export function realtime(): RealtimeClient {
  if (!shared) {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    shared = new RealtimeClient(`${scheme}://${window.location.host}/api/realtime`);
  }
  return shared;
}

/** Replaces the shared client; tests use it to inject a fake. */
export function setRealtimeClient(client: RealtimeClient | undefined): void {
  shared = client;
}

/** Subscribes while mounted; handlers may change between renders without resubscribing. */
export function useRealtime(
  topic: string | undefined,
  onMessage: Listener,
  onReconnect: () => void,
): void {
  const handlers = useRef({ onMessage, onReconnect });
  handlers.current = { onMessage, onReconnect };
  useEffect(() => {
    if (!topic) return;
    return realtime().subscribe(
      topic,
      (message) => handlers.current.onMessage(message),
      () => handlers.current.onReconnect(),
    );
  }, [topic]);
}
