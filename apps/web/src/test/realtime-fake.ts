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
      for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify(message) });
    },
    reset() {
      client.stop();
      setRealtimeClient(undefined);
    },
  };
}
