import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CreatedToken } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let token: string;

beforeEach(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  const owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
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
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/me/tokens',
    headers,
    payload: { name: 'SDK client', scopes: ['read', 'issues:write'] },
  });
  token = created.json<CreatedToken>().token;
  await t.app.listen(0, '127.0.0.1');
});
afterEach(() => t.close());

describe('official MCP SDK client', () => {
  it('connects over Streamable HTTP, lists tools and calls one', async () => {
    const url = new URL('/mcp', await t.app.getUrl());
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'ordler-test', version: '1.0.0' });
    await client.connect(transport);
    expect(client.getServerVersion()).toMatchObject({ name: 'ordler' });

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('create_issue');

    const result = await client.callTool({
      name: 'create_issue',
      arguments: { team: 'HELP', title: 'Created by an agent' },
    });
    expect(result.isError).toBeFalsy();
    const [content] = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content!.text)).toMatchObject({ identifier: 'HELP-1' });

    const resource = await client.readResource({ uri: 'ordler://issue/HELP-1' });
    expect(resource.contents[0]).toMatchObject({ uri: 'ordler://issue/HELP-1' });
    await client.close();
  });
});
