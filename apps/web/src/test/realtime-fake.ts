import type { RealtimeServerMessage } from '@ordler/shared';
import { RealtimeClient, setRealtimeClient, type SocketLike } from '../realtime/client.js';

/** Installs a realtime client backed by a fake socket; `push` delivers a server message. */
export function fakeRealtime() {
  const sockets: SocketLike[] = [];
  const client = new RealtimeClient('ws://ordler.test/api/realtime', () => {
    const socket: SocketLike = {
      readyState: 0,
      send: () => undefined,
      close: () => undefined,
      onopen: null,
      onclose: null,
      onmessage: null,
    };
    sockets.push(socket);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.onopen?.();
    });
    return socket;
  });
  setRealtimeClient(client);
  return {
    push(message: RealtimeServerMessage) {
      // Nothing subscribed yet means the message would vanish and the test would race;
      // wait for `listening()` first.
      if (!sockets.some((socket) => socket.onmessage)) {
        throw new Error(`realtime.push(${message.type}) before anything subscribed`);
      }
      for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify(message) });
    },
    /** True once a component has subscribed, so pushed messages reach it. */
    listening() {
      return sockets.some((socket) => socket.onmessage);
    },
    reset() {
      client.stop();
      setRealtimeClient(undefined);
    },
  };
}
