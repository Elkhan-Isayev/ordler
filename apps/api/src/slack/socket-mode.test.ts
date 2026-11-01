import { describe, expect, it, vi } from 'vitest';
import { SocketModeClient, type SocketLike } from './socket-mode.js';

class FakeSocket implements SocketLike {
  readonly sent: unknown[] = [];
  closed = false;
  private listeners: Record<string, Array<(event: { data?: unknown }) => void>> = {};

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.emit('close');
  }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data) });
  }
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('SocketModeClient', () => {
  it('connects, acknowledges envelopes with the handler result and reconnects on disconnect', async () => {
    const sockets: FakeSocket[] = [];
    const states: string[] = [];
    const open = vi.fn(async () => `wss://slack.test/${open.mock.calls.length}`);
    const dispatch = vi.fn(async (type: string) =>
      type === 'interactive' ? { response_action: 'clear' } : undefined,
    );
    const client = new SocketModeClient({
      open,
      dispatch,
      socket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onState: (state) => states.push(state),
      backoff: () => 0,
    });
    client.start();
    await settle();
    sockets[0]!.emit('message', { type: 'hello' });
    expect(states).toContain('connected');

    sockets[0]!.emit('message', { type: 'interactive', envelope_id: 'e1', payload: { a: 1 } });
    sockets[0]!.emit('message', { type: 'events_api', envelope_id: 'e2', payload: {} });
    await settle();
    expect(dispatch).toHaveBeenCalledWith('interactive', { a: 1 });
    expect(sockets[0]!.sent).toEqual([
      { envelope_id: 'e1', payload: { response_action: 'clear' } },
      { envelope_id: 'e2' },
    ]);

    // Slack's rotation hint: close and open a fresh connection.
    sockets[0]!.emit('message', { type: 'disconnect' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await settle();
    expect(sockets).toHaveLength(2);
    expect(open).toHaveBeenCalledTimes(2);

    client.stop();
    expect(sockets[1]!.closed).toBe(true);
  });

  it('retries with backoff while the connection URL cannot be opened', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const client = new SocketModeClient({
      open: async () => {
        attempts += 1;
        throw new Error('invalid_auth');
      },
      dispatch: async () => undefined,
      socket: () => new FakeSocket(),
      backoff: (failures) => {
        delays.push(failures);
        return 0;
      },
    });
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    client.stop();
    expect(attempts).toBeGreaterThan(1);
    expect(delays.slice(0, 2)).toEqual([1, 2]);
  });
});
