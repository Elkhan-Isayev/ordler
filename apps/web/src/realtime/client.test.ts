import { describe, expect, it, vi } from 'vitest';
import { RealtimeClient, type SocketLike } from './client.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.drop();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  const client = new RealtimeClient(
    'ws://ordler.test/api/realtime',
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    (fn) => {
      timers.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
  return { client, sockets, timers };
}

describe('RealtimeClient', () => {
  it('connects on the first subscription and subscribes once open', () => {
    const { client, sockets } = setup();
    client.subscribe('team:t1', vi.fn());
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    expect(sockets[0]!.sent).toEqual([{ type: 'subscribe', topic: 'team:t1' }]);
  });

  it('delivers server messages to listeners', () => {
    const { client, sockets } = setup();
    const listener = vi.fn();
    client.subscribe('team:t1', listener);
    sockets[0]!.open();
    sockets[0]!.receive({ type: 'issue.changed', issue: { id: 'i1' } });
    expect(listener).toHaveBeenCalledWith({ type: 'issue.changed', issue: { id: 'i1' } });
  });

  it('shares topics between components and unsubscribes after the last one', () => {
    const { client, sockets } = setup();
    const first = client.subscribe('team:t1', vi.fn());
    const second = client.subscribe('team:t1', vi.fn());
    sockets[0]!.open();
    first();
    expect(sockets[0]!.sent).toEqual([{ type: 'subscribe', topic: 'team:t1' }]);
    second();
    expect(sockets[0]!.sent.at(-1)).toEqual({ type: 'unsubscribe', topic: 'team:t1' });
  });

  it('reconnects with backoff, resubscribes and asks listeners to refetch', () => {
    const { client, sockets, timers } = setup();
    const refetch = vi.fn();
    client.subscribe('team:t1', vi.fn(), refetch);
    sockets[0]!.open();
    expect(refetch).not.toHaveBeenCalled();

    sockets[0]!.drop();
    expect(sockets).toHaveLength(1);
    timers.shift()!();
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([{ type: 'subscribe', topic: 'team:t1' }]);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('stays disconnected when nothing is subscribed', () => {
    const { client, sockets, timers } = setup();
    const unsubscribe = client.subscribe('team:t1', vi.fn());
    sockets[0]!.open();
    unsubscribe();
    sockets[0]!.drop();
    expect(timers).toHaveLength(0);
  });
});
