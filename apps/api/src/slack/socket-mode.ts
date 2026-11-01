/** The subset of the WebSocket API the client uses; Node 22+ ships one globally. */
export interface SocketLike {
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: { data?: unknown }) => void,
  ): void;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface SocketModeOptions {
  /** `apps.connections.open` with the app-level token; returns a fresh wss:// URL. */
  open: () => Promise<string>;
  /** Handles an envelope; the result becomes the acknowledgement payload. */
  dispatch: (type: string, payload: unknown) => Promise<object | undefined>;
  onState?: (state: 'connected' | 'connecting' | 'disconnected', error?: string) => void;
  socket?: SocketFactory;
  /** Delay before reconnecting after the n-th failure in a row. */
  backoff?: (failures: number) => number;
  log?: (message: string) => void;
}

/**
 * Slack Socket Mode (SPEC §7.1): Ordler opens an outbound WebSocket, so on-premises installs
 * need no public URL. Envelopes are acknowledged after handling; Slack's `disconnect` hint and
 * dropped sockets both lead to a fresh connection.
 */
export class SocketModeClient {
  private socket: SocketLike | undefined;
  private stopped = true;
  private failures = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: SocketModeOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = undefined;
    this.options.onState?.('disconnected');
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.options.onState?.('connecting');
    let url: string;
    try {
      url = await this.options.open();
    } catch (error) {
      return this.retry(error instanceof Error ? error.message : String(error));
    }
    if (this.stopped) return;
    const socket = (this.options.socket ?? ((u) => new WebSocket(u) as unknown as SocketLike))(url);
    this.socket = socket;
    let closed = false;
    const onClosed = () => {
      if (closed) return;
      closed = true;
      if (this.socket === socket) this.socket = undefined;
      if (!this.stopped) this.retry('connection closed');
    };
    socket.addEventListener('close', onClosed);
    socket.addEventListener('error', onClosed);
    socket.addEventListener('message', (event) => void this.receive(socket, event.data));
  }

  private async receive(socket: SocketLike, data: unknown): Promise<void> {
    let message: { type?: string; envelope_id?: string; payload?: unknown };
    try {
      message = JSON.parse(String(data)) as typeof message;
    } catch {
      return;
    }
    if (message.type === 'hello') {
      this.failures = 0;
      this.options.onState?.('connected');
      return;
    }
    if (message.type === 'disconnect') {
      // Slack rotates connections; open the next one before this one goes away.
      socket.close();
      return;
    }
    if (!message.envelope_id) return;
    let payload: object | undefined;
    try {
      payload = await this.options.dispatch(message.type ?? '', message.payload);
    } catch (error) {
      this.options.log?.(`Slack ${message.type} handling failed: ${String(error)}`);
    }
    socket.send(
      JSON.stringify({ envelope_id: message.envelope_id, ...(payload ? { payload } : {}) }),
    );
  }

  private retry(error: string): void {
    this.failures += 1;
    this.options.onState?.('disconnected', error);
    const delay = (this.options.backoff ?? ((n) => Math.min(30_000, 1000 * 2 ** (n - 1))))(
      this.failures,
    );
    this.timer = setTimeout(() => void this.connect(), delay);
    this.timer.unref?.();
  }
}
