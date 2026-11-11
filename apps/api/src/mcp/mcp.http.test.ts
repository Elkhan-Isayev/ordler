import type {
  AdminRole,
  CreatedToken,
  InviteResponse,
  IssueDetail,
  PersonalTokenView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog, personalTokens } from '../db/schema.js';
import { cookieFrom, createTestApp, TEST_BASE_URL, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];
let dev: { cookie: string; id: string };
let clock: Date;
let rpcId = 0;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

const role = (key: string) => roles.find((r) => r.key === key)!.id;

async function invite(name: string, roleKey: string, scope: object, teamIds: string[]) {
  const created = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name}@push30.test`,
      name,
      role: { roleId: role(roleKey), scope },
      teamIds,
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: created.inviteUrl.split('/invite/')[1]!,
    name,
    password: 'person-password-1',
  });
  return {
    cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE),
    id: created.member.id,
  };
}

async function createToken(cookie: string, body: object = {}) {
  return call('POST', '/api/me/tokens', cookie, {
    name: 'Claude',
    scopes: ['read', 'issues:write'],
    ...body,
  });
}

function mcp(token: string, payload: unknown, headers: Record<string, string> = {}) {
  return t.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    payload: JSON.stringify(payload),
  });
}

async function rpc(token: string, method: string, params?: object) {
  const response = await mcp(token, { jsonrpc: '2.0', id: ++rpcId, method, params });
  expect(response.statusCode).toBe(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- results differ per method
  return response.json<{ result?: any; error?: { code: number; message: string } }>();
}

async function tool(token: string, name: string, args: object = {}) {
  const { result } = await rpc(token, 'tools/call', { name, arguments: args });
  return {
    isError: result.isError === true,
    text: result.content[0].text as string,
    data: () => JSON.parse(result.content[0].text),
  };
}

beforeEach(async () => {
  clock = new Date('2026-10-21T09:00:00Z');
  t = await createTestApp({ now: () => clock });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>();
  const finance = (await call('POST', '/api/admin/departments', owner, { name: 'Finance' })).json<{
    id: string;
  }>();
  const help = (
    await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
    })
  ).json<{ id: string }>();
  await call('POST', `/api/admin/departments/${finance.id}/teams`, owner, {
    name: 'Accounting',
    key: 'ACC',
    isPrivate: true,
  });
  dev = await invite('dev', 'member', { type: 'team', id: help.id }, [help.id]);
  await call('POST', '/api/teams/HELP/issues', owner, { title: 'Printer jam', assigneeId: dev.id });
});
afterEach(() => t.close());

describe('MCP with a personal token (MVP criterion 15)', () => {
  it('lists my issues, creates one in my team, is refused elsewhere and stops after revoke', async () => {
    const created = await createToken(dev.cookie);
    expect(created.statusCode).toBe(201);
    const { token, view } = created.json<CreatedToken>();
    expect(token).toMatch(/^ordl_pat_/);
    expect(view).toMatchObject({
      name: 'Claude',
      prefix: token.slice(0, 13),
      scopes: ['read', 'issues:write'],
    });

    const init = await rpc(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1' },
    });
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'ordler' },
    });
    const initialized = await mcp(token, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(initialized.statusCode).toBe(202);

    const names = (await rpc(token, 'tools/list')).result.tools.map(
      (x: { name: string }) => x.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['list_my_issues', 'create_issue', 'list_my_approvals']),
    );
    // Scope narrows what the agent sees; nothing can decide approvals.
    expect(names).not.toContain('create_request');
    expect(names.some((n: string) => /approve|reject|decide/.test(n))).toBe(false);

    const mine = await tool(token, 'list_my_issues');
    expect(mine.data()).toMatchObject([
      { identifier: 'HELP-1', title: 'Printer jam', url: `${TEST_BASE_URL}/issue/HELP-1` },
    ]);

    const made = await tool(token, 'create_issue', {
      team: 'help',
      title: 'Toner is low',
      priority: 'high',
      assignee: 'me',
    });
    expect(made.isError).toBe(false);
    expect(made.data()).toMatchObject({
      identifier: 'HELP-2',
      priority: 'high',
      assignees: ['dev'],
    });

    const refused = await tool(token, 'create_issue', { team: 'ACC', title: 'Peek at payroll' });
    expect(refused).toMatchObject({ isError: true, text: 'Ordler refused: not_found' });

    // Humans see the agent's writes as the member via that token.
    const issue = (await call('GET', '/api/issues/HELP-2', owner)).json<IssueDetail>();
    expect(issue.events[0]).toMatchObject({
      kind: 'created',
      actor: { name: 'dev' },
      viaToken: 'Claude',
    });
    const audit = await t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'issue.created'));
    expect(audit).toMatchObject([
      { actorType: 'token', actorId: dev.id, after: { identifier: 'HELP-2', via: 'Claude' } },
    ]);

    expect((await call('DELETE', `/api/me/tokens/${view.id}`, dev.cookie)).statusCode).toBe(204);
    for (const payload of [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]) {
      expect((await mcp(token, payload)).statusCode).toBe(401);
    }
  });

  it('cannot decide approvals: REST ignores tokens and no tool exists', async () => {
    const { token } = (await createToken(dev.cookie)).json<CreatedToken>();
    const decision = await t.app.inject({
      method: 'POST',
      url: '/api/approvals/00000000-0000-7000-8000-000000000000/decision',
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'approve' },
    });
    expect(decision.statusCode).toBe(401);
    const unknown = await rpc(token, 'tools/call', { name: 'approve', arguments: {} });
    expect(unknown.error).toMatchObject({ code: -32602 });
  });

  it('enforces scopes on every call', async () => {
    const { token } = (await createToken(dev.cookie, { scopes: ['read'] })).json<CreatedToken>();
    const names = (await rpc(token, 'tools/list')).result.tools.map(
      (x: { name: string }) => x.name,
    );
    expect(names).not.toContain('create_issue');
    const denied = await tool(token, 'create_issue', { team: 'HELP', title: 'x' });
    expect(denied).toMatchObject({
      isError: true,
      text: 'This token lacks the "issues:write" scope.',
    });

    const writer = (
      await createToken(dev.cookie, { scopes: ['issues:write'] })
    ).json<CreatedToken>();
    expect((await rpc(writer.token, 'resources/templates/list')).result.resourceTemplates).toEqual(
      [],
    );
    expect((await tool(writer.token, 'list_my_issues')).isError).toBe(true);
  });

  it('reads resources and validates tool arguments', async () => {
    const { token } = (await createToken(dev.cookie)).json<CreatedToken>();
    const read = await rpc(token, 'resources/read', { uri: 'ordler://issue/HELP-1' });
    expect(JSON.parse(read.result.contents[0].text)).toMatchObject({ identifier: 'HELP-1' });
    const team = await rpc(token, 'resources/read', { uri: 'ordler://team/help' });
    expect(JSON.parse(team.result.contents[0].text)).toMatchObject({
      key: 'HELP',
      members: expect.arrayContaining(['dev']),
    });
    expect((await rpc(token, 'resources/read', { uri: 'ordler://team/ACC' })).error).toMatchObject({
      code: -32002,
    });
    expect((await rpc(token, 'resources/list')).result.resources).toMatchObject([
      { uri: 'ordler://issue/HELP-1' },
    ]);

    const invalid = await tool(token, 'create_issue', { team: 'HELP' });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toMatch(/^Invalid arguments: title/);
    const status = await tool(token, 'update_issue', { identifier: 'HELP-1', status: 'Done' });
    expect(status.data()).toMatchObject({ status: 'Done' });
    expect((await rpc(token, 'nope')).error).toMatchObject({ code: -32601 });
  });

  it('answers batches and rejects malformed messages', async () => {
    const { token } = (await createToken(dev.cookie)).json<CreatedToken>();
    const batch = await mcp(token, [
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { hello: 'world' },
    ]);
    expect(batch.json()).toEqual([
      { jsonrpc: '2.0', id: 'a', result: {} },
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
    ]);
  });
});

describe('MCP endpoint guards', () => {
  it('needs a valid bearer token and a same-site or absent Origin', async () => {
    const missing = await t.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['www-authenticate']).toBe(
      'Bearer realm="ordler", resource_metadata="https://ordler.test/.well-known/oauth-protected-resource/mcp"',
    );
    // A browser session cookie is not enough.
    const cookie = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie: owner },
      payload: {},
    });
    expect(cookie.statusCode).toBe(401);
    expect(
      (await mcp('ordl_pat_unknown', { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode,
    ).toBe(401);

    const { token } = (await createToken(dev.cookie)).json<CreatedToken>();
    const foreign = await mcp(
      token,
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { origin: 'https://evil.test' },
    );
    expect(foreign.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
  });

  it('stops working when the admin turns MCP off', async () => {
    const { token } = (await createToken(dev.cookie)).json<CreatedToken>();
    const off = await call('PUT', '/api/admin/tokens/settings', owner, {
      mcpEnabled: false,
      maxExpiryDays: 365,
      allowNoExpiry: false,
    });
    expect(off.statusCode).toBe(200);
    expect((await mcp(token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(403);
  });

  it('expires tokens and rate-limits each token to 120 requests a minute', async () => {
    const { token } = (await createToken(dev.cookie, { expiresInDays: 1 })).json<CreatedToken>();
    for (let i = 0; i < 120; i += 1) {
      expect((await mcp(token, { jsonrpc: '2.0', id: i, method: 'ping' })).statusCode).toBe(200);
    }
    expect((await mcp(token, { jsonrpc: '2.0', id: 0, method: 'ping' })).statusCode).toBe(429);

    clock = new Date(clock.getTime() + 2 * 86_400_000);
    expect((await mcp(token, { jsonrpc: '2.0', id: 0, method: 'ping' })).statusCode).toBe(401);
  });
});

describe('personal access tokens', () => {
  it('stores only a hash and shows the secret once', async () => {
    const { token, view } = (await createToken(dev.cookie)).json<CreatedToken>();
    const listed = await call('GET', '/api/me/tokens', dev.cookie);
    expect(listed.body).not.toContain(token);
    expect(listed.json<{ tokens: PersonalTokenView[] }>().tokens).toMatchObject([
      { id: view.id, expiresAt: '2027-01-19T09:00:00.000Z', lastUsedAt: null },
    ]);
    const [row] = await t.ctx.db.select().from(personalTokens);
    expect(JSON.stringify(row)).not.toContain(token);

    await rpc(token, 'ping');
    const used = (await call('GET', '/api/me/tokens', dev.cookie)).json<{
      tokens: PersonalTokenView[];
    }>();
    expect(used.tokens[0]!.lastUsedAt).toBe(clock.toISOString());
  });

  it('respects the admin’s expiry limits', async () => {
    expect((await createToken(dev.cookie, { expiresInDays: 400 })).json()).toEqual({
      error: 'token_expiry_too_long',
    });
    expect((await createToken(dev.cookie, { expiresInDays: null })).statusCode).toBe(400);
    await call('PUT', '/api/admin/tokens/settings', owner, {
      mcpEnabled: true,
      maxExpiryDays: 365,
      allowNoExpiry: true,
    });
    const forever = (await createToken(dev.cookie, { expiresInDays: null })).json<CreatedToken>();
    expect(forever.view.expiresAt).toBeNull();
  });

  it('is denied to guests, who lack token.create_personal', async () => {
    const help = (await call('GET', '/api/teams/HELP', owner)).json<{ id: string }>();
    const guest = await invite('guest', 'guest', { type: 'team', id: help.id }, [help.id]);
    expect((await createToken(guest.cookie)).statusCode).toBe(403);
  });

  it('lets org admins list and revoke anyone’s tokens, but not other members', async () => {
    const { token, view } = (await createToken(dev.cookie)).json<CreatedToken>();
    const other = await invite('other', 'member', { type: 'organization' }, []);
    expect((await call('DELETE', `/api/me/tokens/${view.id}`, other.cookie)).statusCode).toBe(403);
    expect((await call('GET', '/api/admin/tokens', dev.cookie)).statusCode).toBe(403);

    const all = (await call('GET', '/api/admin/tokens', owner)).json<{
      tokens: PersonalTokenView[];
    }>();
    expect(all.tokens).toMatchObject([{ id: view.id, member: { name: 'dev' } }]);
    expect((await call('DELETE', `/api/admin/tokens/${view.id}`, owner)).statusCode).toBe(204);
    expect((await mcp(token, { jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode).toBe(401);
    const audit = await t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'personal_token.revoked'));
    expect(audit).toHaveLength(1);
  });
});

describe('MCP whiteboards (SPEC §5.5)', () => {
  it('draws a diagram on a new board, attaches it to an issue and reads it back', async () => {
    const { token } = (await createToken(dev.cookie)).json<CreatedToken>();
    const created = await tool(token, 'create_whiteboard', {
      team: 'HELP',
      title: 'Printer escalation',
      issue: 'HELP-1',
      nodes: [
        { id: 'jam', label: 'Printer jams', shape: 'ellipse' },
        { id: 'fix', label: 'Can the user fix it?', shape: 'diamond' },
        { id: 'ticket', label: 'Call the vendor', color: 'red' },
      ],
      edges: [
        { from: 'jam', to: 'fix' },
        { from: 'fix', to: 'ticket', label: 'no' },
      ],
    });
    expect(created.isError).toBe(false);
    const board = created.data();
    expect(board).toMatchObject({
      title: 'Printer escalation',
      team: 'HELP',
      issues: ['HELP-1'],
      canEdit: true,
      connectors: [
        { from: 'jam', to: 'fix', label: null },
        { from: 'fix', to: 'ticket', label: 'no' },
      ],
    });
    expect(board.shapes.map((s: { label: string }) => s.label)).toEqual([
      'Printer jams',
      'Can the user fix it?',
      'Call the vendor',
    ]);
    expect(board.url).toBe(`https://ordler.test/whiteboards/${board.id}`);

    // People see it in Ordler, and the issue lists it as a resource for the agent.
    const scene = (await call('GET', `/api/whiteboards/${board.id}/scene`, dev.cookie)).json<{
      elements: unknown[];
    }>();
    expect(scene.elements.length).toBeGreaterThanOrEqual(7);
    const issue = (await tool(token, 'get_issue', { identifier: 'HELP-1' })).data();
    expect(issue.whiteboards).toEqual([
      expect.objectContaining({ id: board.id, resource: `ordler://whiteboard/${board.id}` }),
    ]);
    const resource = await rpc(token, 'resources/read', { uri: `ordler://whiteboard/${board.id}` });
    expect(JSON.parse(resource.result.contents[0].text)).toMatchObject({ id: board.id });

    const added = await tool(token, 'add_to_whiteboard', {
      id: board.id,
      nodes: [{ id: 'done', label: 'Printing again', color: 'green' }],
      edges: [{ from: 'ticket', to: 'done' }],
    });
    expect(added.data().connectors).toHaveLength(3);
    expect((await tool(token, 'list_whiteboards', { team: 'HELP' })).data()).toMatchObject([
      { id: board.id, title: 'Printer escalation' },
    ]);

    const audited = await t.ctx.db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.targetId, board.id));
    expect(audited).toEqual(
      expect.arrayContaining([
        { action: 'whiteboard.created', after: { title: 'Printer escalation', via: 'Claude' } },
        { action: 'whiteboard.linked', after: { issue: 'HELP-1', via: 'Claude' } },
        {
          action: 'whiteboard.content_changed',
          after: { elements: expect.any(Number), via: 'Claude' },
        },
      ]),
    );
  });

  it('reports diagram mistakes without leaving an empty board behind', async () => {
    const { token } = (await createToken(dev.cookie)).json<CreatedToken>();
    const wrong = await tool(token, 'create_whiteboard', {
      team: 'HELP',
      title: 'Broken',
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ from: 'a', to: 'missing' }],
    });
    expect(wrong).toMatchObject({ isError: true, text: expect.stringMatching(/^Invalid diagram/) });
    expect((await tool(token, 'list_whiteboards')).data()).toEqual([]);
    const elsewhere = await tool(token, 'create_whiteboard', { team: 'ACC', title: 'Peek' });
    expect(elsewhere).toMatchObject({ isError: true, text: 'Ordler refused: not_found' });
  });

  it('keeps read-only tokens to reading boards', async () => {
    const { token } = (await createToken(dev.cookie, { scopes: ['read'] })).json<CreatedToken>();
    const names = (await rpc(token, 'tools/list')).result.tools.map(
      (x: { name: string }) => x.name,
    );
    expect(names).toEqual(expect.arrayContaining(['list_whiteboards', 'get_whiteboard']));
    expect(names).not.toContain('create_whiteboard');
    expect((await tool(token, 'create_whiteboard', { team: 'HELP', title: 'x' })).isError).toBe(
      true,
    );
    const missing = await tool(token, 'get_whiteboard', {
      id: '00000000-0000-7000-8000-000000000000',
    });
    expect(missing).toMatchObject({ isError: true, text: 'Ordler refused: not_found' });
  });
});
