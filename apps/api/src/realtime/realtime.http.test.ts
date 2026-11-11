import type { IssueDetail, RealtimeServerMessage, TeamView, WhiteboardView } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import { REALTIME_PATH } from './realtime.gateway.js';

let t: TestApp;
let owner: string;
let team: TeamView;
let url: string;
const sockets: WebSocket[] = [];

/** A real TCP WebSocket, like a browser tab: it answers the server's pings. */
function open(headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    sockets.push(socket);
    socket.once('open', () => resolve(socket));
    socket.once('unexpected-response', (_request, response) =>
      reject(new Error(`HTTP ${response.statusCode}`)),
    );
    socket.once('error', reject);
  });
}

/** Opens a socket and collects every message it receives. */
async function connect(cookie: string, origin = TEST_BASE_URL) {
  const socket = await open({ cookie, origin });
  const messages: RealtimeServerMessage[] = [];
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  socket.on('message', (data) =>
    messages.push(JSON.parse(data.toString()) as RealtimeServerMessage),
  );
  // Returns messages in order, waiting only for those not consumed yet.
  let read = 0;
  const next = async () => {
    read += 1;
    await expect.poll(() => messages.length, { timeout: 5000 }).toBeGreaterThanOrEqual(read);
    return messages[read - 1]!;
  };
  return { socket, messages, next, closed };
}

beforeEach(async () => {
  t = await createTestApp({ realtimeHeartbeatMs: 100 });
  const setup = await t.app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const headers = { cookie: owner };
  const dept = (
    await t.app.inject({
      method: 'POST',
      url: '/api/admin/departments',
      headers,
      payload: { name: 'IT' },
    })
  ).json<{ id: string }>();
  await t.app.inject({
    method: 'POST',
    url: `/api/admin/departments/${dept.id}/teams`,
    headers,
    payload: { name: 'Helpdesk', key: 'HELP' },
  });
  team = (await t.app.inject({ url: '/api/teams/HELP', headers })).json<TeamView>();
  await t.app.listen(0, '127.0.0.1');
  url = `${(await t.app.getUrl()).replace('http', 'ws')}${REALTIME_PATH}`;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await t.close();
});

describe('realtime updates', () => {
  it('pushes issue changes to subscribed tabs', async () => {
    const tab = await connect(owner);
    tab.socket.send(JSON.stringify({ type: 'subscribe', topic: `team:${team.id}` }));
    expect(await tab.next()).toEqual({ type: 'subscribed', topic: `team:${team.id}` });

    const created = (
      await t.app.inject({
        method: 'POST',
        url: '/api/teams/HELP/issues',
        headers: { cookie: owner },
        payload: { title: 'Laptop broken' },
      })
    ).json<IssueDetail>();
    expect(await tab.next()).toMatchObject({
      type: 'issue.changed',
      issue: { identifier: 'HELP-1', title: 'Laptop broken' },
    });

    // Survives several heartbeats: the client answers pings.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const done = team.statuses.find((s) => s.key === 'done')!.id;
    await t.app.inject({
      method: 'PATCH',
      url: `/api/issues/${created.identifier}`,
      headers: { cookie: owner },
      payload: { statusId: done },
    });
    expect(await tab.next()).toMatchObject({ type: 'issue.changed', issue: { statusId: done } });
  });

  it('denies teams the member cannot read', async () => {
    const tab = await connect(owner);
    tab.socket.send(
      JSON.stringify({ type: 'subscribe', topic: 'team:00000000-0000-7000-8000-000000000000' }),
    );
    expect(await tab.next()).toMatchObject({ type: 'denied' });
    tab.socket.send(JSON.stringify({ type: 'subscribe', topic: 'nonsense' }));
    expect(await tab.next()).toMatchObject({ type: 'denied', topic: 'nonsense' });
  });

  it('pushes Inbox changes only to the member’s own topic', async () => {
    const me = (await t.app.inject({ url: '/api/me', headers: { cookie: owner } })).json<{
      member: { id: string };
    }>();
    const tab = await connect(owner);
    tab.socket.send(
      JSON.stringify({ type: 'subscribe', topic: 'member:00000000-0000-7000-8000-000000000000' }),
    );
    expect(await tab.next()).toMatchObject({ type: 'denied' });
    tab.socket.send(JSON.stringify({ type: 'subscribe', topic: `member:${me.member.id}` }));
    expect(await tab.next()).toEqual({ type: 'subscribed', topic: `member:${me.member.id}` });

    await t.ctx.events.publish({
      type: 'member.inbox',
      memberIds: ['00000000-0000-7000-8000-000000000001'],
    });
    await t.ctx.events.publish({ type: 'member.inbox', memberIds: [me.member.id] });
    expect(await tab.next()).toEqual({ type: 'inbox.changed' });
    expect(tab.messages).toHaveLength(3);
  });

  it('refuses connections without a session or from another site', async () => {
    await expect(open({ origin: TEST_BASE_URL })).rejects.toThrow('HTTP 401');
    await expect(open({ cookie: owner, origin: 'https://evil.test' })).rejects.toThrow('HTTP 403');
  });

  it('closes the socket once the session ends', async () => {
    const tab = await connect(owner);
    await t.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: owner } });
    expect(await tab.closed).toBe(4401);
  });

  it('closes on malformed messages', async () => {
    const tab = await connect(owner);
    tab.socket.send('not json');
    expect(await tab.closed).toBe(1003);
  });
});

describe('realtime whiteboards (ADR 0015)', () => {
  async function openBoard() {
    const board = (
      await t.app.inject({
        method: 'POST',
        url: '/api/whiteboards',
        headers: { cookie: owner },
        payload: { team: 'HELP', title: 'Sketch' },
      })
    ).json<WhiteboardView>();
    const topic = `whiteboard:${board.id}`;
    const join = async () => {
      const tab = await connect(owner);
      tab.socket.send(JSON.stringify({ type: 'subscribe', topic }));
      expect(await tab.next()).toEqual({ type: 'subscribed', topic });
      return tab;
    };
    return { board, topic, join };
  }

  it('pushes saved elements to every open tab of the board', async () => {
    const { board, join } = await openBoard();
    const [a, b] = [await join(), await join()];
    const element = {
      id: 'box',
      type: 'rectangle',
      version: 1,
      versionNonce: 4,
      isDeleted: false,
      x: 1,
    };
    await t.app.inject({
      method: 'POST',
      url: `/api/whiteboards/${board.id}/scene`,
      headers: { cookie: owner },
      payload: { elements: [element] },
    });
    const expected = {
      type: 'whiteboard.elements',
      whiteboardId: board.id,
      seq: 1,
      elements: [element],
    };
    expect(await a.next()).toEqual(expected);
    expect(await b.next()).toEqual(expected);

    await t.app.inject({
      method: 'PATCH',
      url: `/api/whiteboards/${board.id}`,
      headers: { cookie: owner },
      payload: { title: 'Renamed' },
    });
    expect(await a.next()).toEqual({ type: 'whiteboard.changed', whiteboardId: board.id });
  });

  it('shares pointers with the other tabs, and says when a tab leaves', async () => {
    const { topic, join, board } = await openBoard();
    const [a, b] = [await join(), await join()];
    a.socket.send(
      JSON.stringify({
        type: 'presence',
        topic,
        pointer: { x: 10, y: 20 },
        button: 'down',
        selectedElementIds: ['box'],
      }),
    );
    const seen = await b.next();
    expect(seen).toMatchObject({
      type: 'whiteboard.presence',
      whiteboardId: board.id,
      presence: {
        member: { name: OWNER.name },
        pointer: { x: 10, y: 20, tool: 'pointer' },
        button: 'down',
        selectedElementIds: ['box'],
      },
    });
    const clientId = (seen as Extract<RealtimeServerMessage, { type: 'whiteboard.presence' }>)
      .presence.clientId;

    a.socket.send(JSON.stringify({ type: 'unsubscribe', topic }));
    expect(await b.next()).toMatchObject({ presence: { clientId, left: true, pointer: null } });
    // The sender never hears its own pointer.
    expect(a.messages).toHaveLength(1);
  });

  it('ignores pointers for boards the tab has not joined and denies unknown boards', async () => {
    const { topic, join } = await openBoard();
    const watcher = await join();
    const stranger = await connect(owner);
    stranger.socket.send(JSON.stringify({ type: 'presence', topic, pointer: { x: 1, y: 1 } }));
    stranger.socket.send(
      JSON.stringify({
        type: 'subscribe',
        topic: 'whiteboard:00000000-0000-7000-8000-000000000000',
      }),
    );
    expect(await stranger.next()).toMatchObject({ type: 'denied' });
    expect(watcher.messages).toHaveLength(1);
  });
});
