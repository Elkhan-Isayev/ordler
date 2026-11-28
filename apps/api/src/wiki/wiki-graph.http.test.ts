import type {
  AdminRole,
  CreatedToken,
  InviteResponse,
  WikiGraph,
  WikiPageView,
  WikiRelationView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../db/schema.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import { wikiSearchWords } from './wiki.service.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];
const ids = {} as Record<'it' | 'finance', string>;
type Person = 'anna' | 'viewer' | 'outsider' | 'head';
const people = {} as Record<Person, { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function person(name: Person, role: string, departmentId: string) {
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name.toLowerCase()}@acme.test`,
      name,
      role: {
        roleId: roles.find((r) => r.key === role)!.id,
        scope: { type: 'department', id: departmentId },
      },
      teamIds: [],
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: invite.inviteUrl.split('/invite/')[1]!,
    name,
    password: 'person-password-1',
  });
  people[name] = {
    cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE),
    id: invite.member.id,
  };
}

beforeEach(async () => {
  t = await createTestApp({ attachmentMaxBytes: 1024 });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Acme',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const dept = async (name: string) =>
    (await call('POST', '/api/admin/departments', owner, { name })).json<{ id: string }>().id;
  ids.it = await dept('IT');
  ids.finance = await dept('Finance');
  await call('POST', `/api/admin/departments/${ids.it}/teams`, owner, {
    name: 'Helpdesk',
    key: 'HELP',
    isPrivate: false,
  });
  await person('anna', 'member', ids.it);
  await person('viewer', 'viewer', ids.it);
  await person('outsider', 'member', ids.finance);
  await person('head', 'department_admin', ids.it);
  await call('POST', '/api/teams/HELP/issues', owner, { title: 'Office network' });
});
afterEach(() => t.close());

async function page(cookie: string, title: string, content = '', department = ids.it) {
  const response = await call('POST', '/api/wiki/pages', cookie, { department, title, content });
  expect(response.statusCode).toBe(201);
  return response.json<WikiPageView>();
}

const relations = async (cookie: string, id: string) =>
  (await call('GET', `/api/wiki/pages/${id}/relations`, cookie)).json<WikiRelationView[]>();

const summary = (list: WikiRelationView[]) =>
  list.map((r) => `${r.direction} ${r.origin} ${r.type} ${r.node.kind}:${r.node.label}`);

describe('wiki relations (ADR 0018)', () => {
  it('stores typed relations and reads links in the text, in both directions', async () => {
    const vpn = await page(people.anna.cookie, 'VPN setup');
    const onboarding = await page(
      people.anna.cookie,
      'Onboarding',
      `Start with [[vpn setup]], then [the VPN](/wiki/page/${vpn.id}). Ask in [HELP-1](/issue/HELP-1).`,
    );
    const policy = await page(people.anna.cookie, 'Security policy');

    const added = await call(
      'POST',
      `/api/wiki/pages/${onboarding.id}/relations`,
      people.anna.cookie,
      {
        target: 'Security policy',
        type: 'depends_on',
        note: 'Read first',
      },
    );
    expect(added.statusCode).toBe(201);
    expect(summary(added.json<WikiRelationView[]>())).toEqual([
      'out manual depends_on wiki_page:Security policy',
      'out link references wiki_page:VPN setup',
      'out link references issue:HELP-1 Office network',
    ]);
    expect(added.json<WikiRelationView[]>()[0]).toMatchObject({
      note: 'Read first',
      canRemove: true,
      node: { href: `/wiki/page/${policy.id}`, department: { id: ids.it, name: 'IT' } },
    });

    // Adding the same relation again changes nothing.
    await call('POST', `/api/wiki/pages/${onboarding.id}/relations`, people.anna.cookie, {
      target: policy.id,
      type: 'depends_on',
    });
    expect(await relations(people.anna.cookie, onboarding.id)).toHaveLength(3);

    expect(summary(await relations(people.anna.cookie, vpn.id))).toEqual([
      'in link references wiki_page:Onboarding',
    ]);
    expect(summary(await relations(people.anna.cookie, policy.id))).toEqual([
      'in manual depends_on wiki_page:Onboarding',
    ]);

    const issue = await call('POST', `/api/wiki/pages/${policy.id}/relations`, people.anna.cookie, {
      target: 'help-1',
    });
    expect(summary(issue.json<WikiRelationView[]>())).toContain(
      'out manual related issue:HELP-1 Office network',
    );
    const [entry] = await t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'wiki.relation_added'));
    expect(entry).toMatchObject({
      actorId: people.anna.id,
      after: { targetKind: 'wiki_page', targetRef: policy.id, type: 'depends_on' },
    });
  });

  it('refuses relations to the page itself or to things that do not exist', async () => {
    const one = await page(people.anna.cookie, 'One');
    for (const body of [
      { target: one.id },
      { target: 'No such page' },
      { target: 'HELP-99' },
      { target: 'REQ-7' },
      { targetKind: 'whiteboard', target: 'not-a-board' },
    ]) {
      const response = await call(
        'POST',
        `/api/wiki/pages/${one.id}/relations`,
        people.anna.cookie,
        body,
      );
      expect(response.statusCode).toBe(400);
    }
  });

  it('lets only editors add and remove relations; readers see them', async () => {
    const a = await page(people.anna.cookie, 'A');
    await page(people.anna.cookie, 'B');
    const denied = await call('POST', `/api/wiki/pages/${a.id}/relations`, people.viewer.cookie, {
      target: 'B',
    });
    expect(denied.statusCode).toBe(403);

    const [relation] = (
      await call('POST', `/api/wiki/pages/${a.id}/relations`, people.anna.cookie, { target: 'B' })
    ).json<WikiRelationView[]>();
    const seen = await relations(people.viewer.cookie, a.id);
    expect(seen).toEqual([expect.objectContaining({ id: relation!.id, canRemove: false })]);
    expect(
      (await call('DELETE', `/api/wiki/relations/${relation!.id}`, people.viewer.cookie))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('GET', `/api/wiki/pages/${a.id}/relations`, people.outsider.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call('DELETE', `/api/wiki/relations/${relation!.id}`, people.outsider.cookie))
        .statusCode,
    ).toBe(404);

    const removed = await call('DELETE', `/api/wiki/relations/${relation!.id}`, people.anna.cookie);
    expect(removed.statusCode).toBe(204);
    expect(await relations(people.anna.cookie, a.id)).toEqual([]);
    const [entry] = await t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'wiki.relation_removed'));
    expect(entry).toMatchObject({ before: { relationId: relation!.id, type: 'related' } });
  });

  it('hides relations to pages and issues the reader cannot open', async () => {
    const finance = await page(people.outsider.cookie, 'Budget', '', ids.finance);
    const it = await page(people.anna.cookie, 'Network', 'See [HELP-1](/issue/HELP-1).');
    // The owner reads both spaces and links them.
    await call('POST', `/api/wiki/pages/${it.id}/relations`, owner, { target: finance.id });
    await call('PATCH', `/api/wiki/spaces/${ids.it}`, people.head.cookie, {
      visibility: 'organization',
    });

    expect(summary(await relations(people.anna.cookie, it.id))).toEqual([
      'out link references issue:HELP-1 Office network',
    ]);
    // The Finance member reads the open IT space but not the Helpdesk team's issues.
    expect(summary(await relations(people.outsider.cookie, it.id))).toEqual([
      'out manual related wiki_page:Budget',
    ]);
  });

  it('resolves linked issues in one batch, only for members who may read them', async () => {
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Printer' });
    expect([
      ...(await t.ctx.issues.briefs(people.anna.id, ['help-2', 'HELP-1', 'HELP-9', 'x'])),
    ]).toEqual([
      ['HELP-1', { identifier: 'HELP-1', title: 'Office network' }],
      ['HELP-2', { identifier: 'HELP-2', title: 'Printer' }],
    ]);
    // Hidden issues come back as null, so the map does not check them again one by one.
    expect([...(await t.ctx.issues.briefs(people.outsider.id, ['HELP-1']))]).toEqual([
      ['HELP-1', null],
    ]);

    await page(people.anna.cookie, 'Network', 'See [HELP-1](/issue/HELP-1) and /issue/HELP-2.');
    await call('PATCH', `/api/wiki/spaces/${ids.it}`, people.head.cookie, {
      visibility: 'organization',
    });
    const labels = async (cookie: string) =>
      (await call('GET', '/api/wiki/graph', cookie))
        .json<WikiGraph>()
        .nodes.filter((n) => n.kind === 'issue')
        .map((n) => n.label)
        .sort();
    expect(await labels(people.anna.cookie)).toEqual(['HELP-1 Office network', 'HELP-2 Printer']);
    expect(await labels(people.outsider.cookie)).toEqual([]);
  });
});

describe('wiki map (ADR 0018)', () => {
  it('draws the readable wiki with departments and folders as clusters', async () => {
    const folder = (
      await call('POST', '/api/wiki/folders', people.anna.cookie, {
        department: ids.it,
        name: 'Guides',
      })
    ).json<{ id: string }>();
    const vpn = await page(people.anna.cookie, 'VPN');
    await call('PATCH', `/api/wiki/pages/${vpn.id}`, people.anna.cookie, { folderId: folder.id });
    const home = await page(
      people.anna.cookie,
      'Home',
      'Read [[VPN]] and [HELP-1](/issue/HELP-1).',
    );
    await call('POST', `/api/wiki/pages/${home.id}/relations`, people.anna.cookie, {
      target: 'VPN',
      type: 'part_of',
    });
    await page(people.outsider.cookie, 'Budget', '', ids.finance);

    const graph = (await call('GET', '/api/wiki/graph', people.anna.cookie)).json<WikiGraph>();
    expect(graph.truncated).toBe(false);
    expect(graph.nodes.map((n) => `${n.kind}:${n.label}`).sort()).toEqual([
      'department:IT',
      'folder:Guides',
      'issue:HELP-1 Office network',
      'wiki_page:Home',
      'wiki_page:VPN',
    ]);
    const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
    expect(
      graph.edges.map((e) => `${label.get(e.source)} ${e.type} ${label.get(e.target)}`).sort(),
    ).toEqual([
      'Guides in IT',
      'Home in IT',
      'Home part_of VPN',
      'Home references HELP-1 Office network',
      'Home references VPN',
      'VPN in Guides',
    ]);

    const all = (await call('GET', '/api/wiki/graph', owner)).json<WikiGraph>();
    expect(
      all.nodes
        .filter((n) => n.kind === 'department')
        .map((n) => n.label)
        .sort(),
    ).toEqual(['Finance', 'IT']);
    const finance = (
      await call('GET', `/api/wiki/graph?department=${ids.finance}`, owner)
    ).json<WikiGraph>();
    expect(finance.nodes.map((n) => n.label).sort()).toEqual(['Budget', 'Finance']);

    expect(
      (await call('GET', `/api/wiki/graph?department=${ids.it}`, people.outsider.cookie))
        .statusCode,
    ).toBe(404);
    const outsider = (
      await call('GET', '/api/wiki/graph', people.outsider.cookie)
    ).json<WikiGraph>();
    expect(outsider.nodes.map((n) => n.label).sort()).toEqual(['Budget', 'Finance']);
  });

  it('gives an AI client the pages around a topic, nearest first, within a budget', async () => {
    const vpn = await page(people.anna.cookie, 'VPN', 'WireGuard everywhere. '.repeat(50));
    const home = await page(people.anna.cookie, 'Home', 'Start with [[VPN]].');
    const far = await page(people.anna.cookie, 'Far away', 'Nothing here.');
    await call('POST', `/api/wiki/pages/${vpn.id}/relations`, people.anna.cookie, {
      target: 'Far away',
    });
    await page(people.anna.cookie, 'Lonely', 'Unrelated.');

    const near = await t.ctx.wikiGraph.context(people.anna.id, {
      pages: [home.id],
      depth: 1,
      limit: 10,
      maxChars: 1000,
    });
    expect(near.pages.map((p) => [p.title, p.distance])).toEqual([
      ['Home', 0],
      ['VPN', 1],
    ]);
    expect(near.pages[1]).toMatchObject({ department: 'IT', folder: null, truncated: true });
    expect(near.pages[1]!.content.length).toBeLessThanOrEqual(501);
    expect(near.relations).toEqual([{ from: 'Home', type: 'references', to: 'VPN' }]);

    const wide = await t.ctx.wikiGraph.context(people.anna.id, {
      query: 'Start with',
      depth: 2,
      limit: 10,
      maxChars: 100_000,
    });
    expect(wide.pages.map((p) => p.title)).toEqual(['Home', 'VPN', 'Far away']);
    expect(wide.pages.find((p) => p.id === far.id)).toMatchObject({ distance: 2 });

    const nobody = await t.ctx.wikiGraph.context(people.outsider.id, {
      pages: [home.id],
      depth: 2,
      limit: 10,
      maxChars: 1000,
    });
    expect(nobody.pages).toEqual([]);
  });

  it('finds pages for a question in plain words, best ranked first, only in readable spaces', async () => {
    const vpn = await page(people.anna.cookie, 'VPN setup', 'Install WireGuard on the laptop.');
    await page(people.anna.cookie, 'Laptops', 'Every laptop gets a VPN profile.');
    await page(people.anna.cookie, 'Lunch', 'The canteen opens at noon.');
    await page(people.outsider.cookie, 'Finance VPN', 'VPN for the bank.', ids.finance);

    const question = 'How do I set up the VPN on my new laptop?';
    expect(wikiSearchWords(question)).toEqual(['set', 'up', 'vpn', 'new', 'laptop']);
    expect(wikiSearchWords('Как настроить VPN на ноутбуке?')).toEqual([
      'настроить',
      'vpn',
      'ноутбуке',
    ]);
    // No page holds the whole phrase, yet the words find the right ones.
    expect(await t.ctx.wiki.search(people.anna.id, question)).toEqual([]);
    const hits = await t.ctx.wiki.searchForAgents(people.anna.id, question);
    expect(hits.map((h) => h.title)).toEqual(['VPN setup', 'Laptops']);
    expect(hits[0]!.snippet).toContain('laptop');

    // The exact phrase still comes first.
    const exact = await t.ctx.wiki.searchForAgents(people.anna.id, 'VPN profile');
    expect(exact[0]!.title).toBe('Laptops');

    const context = await t.ctx.wikiGraph.context(people.anna.id, {
      query: question,
      depth: 0,
      limit: 5,
      maxChars: 10_000,
    });
    expect(context.pages.map((p) => p.id)).toContain(vpn.id);
    expect(context.pages.map((p) => p.title)).not.toContain('Finance VPN');
  });

  it('starts from an issue: the pages about it, then their neighbours', async () => {
    const network = await page(people.anna.cookie, 'Network', 'Tracked in [x](/issue/HELP-1).');
    const printers = await page(people.anna.cookie, 'Printers', 'No link in the text.');
    await call('POST', `/api/wiki/pages/${printers.id}/relations`, people.anna.cookie, {
      targetKind: 'issue',
      target: 'help-1',
      type: 'depends_on',
    });
    await page(people.anna.cookie, 'Cabling', 'Background for [[Network]].');
    await page(people.anna.cookie, 'Other issue', 'See /issue/HELP-10 only.');
    await call('PATCH', `/api/wiki/spaces/${ids.it}`, people.head.cookie, {
      visibility: 'organization',
    });

    const about = await t.ctx.wikiGraph.context(people.anna.id, {
      issue: 'help-1',
      depth: 1,
      limit: 10,
      maxChars: 10_000,
    });
    expect(about.pages.map((p) => [p.title, p.distance])).toEqual([
      ['Network', 0],
      ['Printers', 0],
      ['Cabling', 1],
    ]);
    expect(about.linked).toEqual([
      { kind: 'issue', ref: 'HELP-1', label: 'HELP-1 Office network' },
    ]);
    expect(await t.ctx.wikiGraph.pagesAbout(people.anna.id, 'issue', 'HELP-1')).toEqual([
      { id: network.id, title: 'Network', department: { id: ids.it, name: 'IT' } },
      { id: printers.id, title: 'Printers', department: { id: ids.it, name: 'IT' } },
    ]);

    // The Finance member reads the IT wiki but not the Helpdesk issue: nothing about it.
    await expect(
      t.ctx.wikiGraph.context(people.outsider.id, {
        issue: 'HELP-1',
        depth: 1,
        limit: 10,
        maxChars: 10_000,
      }),
    ).rejects.toThrow('not_found');
  });
});

describe('MCP relation and context tools (ADR 0018)', () => {
  async function token(cookie: string, scopes: string[]) {
    const created = await call('POST', '/api/me/tokens', cookie, { name: 'Claude', scopes });
    return created.json<CreatedToken>().token;
  }

  async function tool(bearer: string, name: string, args: object = {}) {
    const response = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results differ per tool
    const { result } = response.json<{ result: any }>();
    return {
      isError: result.isError === true,
      text: result.content[0].text as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results differ per tool
      data: (): any => JSON.parse(result.content[0].text),
    };
  }

  it('lets an agent relate pages while creating them and read the company context', async () => {
    const writer = await token(people.anna.cookie, ['read', 'wiki:write']);
    const vpn = (
      await tool(writer, 'create_wiki_page', {
        department: 'IT',
        title: 'VPN',
        content: 'WireGuard.',
      })
    ).data();
    const created = await tool(writer, 'create_wiki_page', {
      department: 'IT',
      title: 'Remote work',
      content: 'Work from anywhere.',
      relations: [
        { target: 'VPN', type: 'depends_on' },
        { target: 'HELP-1' },
        { target: 'Missing page' },
      ],
    });
    expect(created.isError).toBe(false);
    const remote = created.data();
    expect(remote.unresolvedRelations).toEqual(['Missing page']);
    expect(remote.relations).toEqual([
      expect.objectContaining({
        direction: 'out',
        type: 'depends_on',
        kind: 'wiki_page',
        ref: vpn.id,
      }),
      expect.objectContaining({ direction: 'out', type: 'related', kind: 'issue', ref: 'HELP-1' }),
    ]);

    const reader = await token(people.anna.cookie, ['read']);
    expect(
      (await tool(reader, 'add_wiki_relation', { page: vpn.id, target: 'Remote work' })).text,
    ).toContain('wiki:write');
    const graph = (await tool(reader, 'get_wiki_graph')).data();
    expect(graph.edges).toContainEqual([
      `wiki_page:${remote.id}`,
      'depends_on',
      `wiki_page:${vpn.id}`,
    ]);
    expect(graph.edges).toContainEqual([`wiki_page:${vpn.id}`, 'in', `department:${ids.it}`]);

    const context = (await tool(reader, 'get_wiki_context', { query: 'anywhere' })).data();
    expect(context.pages.map((p: { title: string }) => p.title)).toEqual(['Remote work', 'VPN']);
    expect(context.linked).toEqual([
      { kind: 'issue', ref: 'HELP-1', label: 'HELP-1 Office network' },
    ]);
    expect(context.pages[1]).toMatchObject({
      content: 'WireGuard.',
      url: expect.stringContaining('/wiki/page/'),
    });

    // An agent picking up HELP-1 sees the pages about it and pulls their context.
    const issue = (await tool(reader, 'get_issue', { identifier: 'HELP-1' })).data();
    expect(issue.wikiPages).toEqual([
      expect.objectContaining({ id: remote.id, title: 'Remote work', department: 'IT' }),
    ]);
    const forIssue = (await tool(reader, 'get_wiki_context', { issue: 'HELP-1' })).data();
    expect(
      forIssue.pages.map((p: { title: string; distance: number }) => [p.title, p.distance]),
    ).toEqual([
      ['Remote work', 0],
      ['VPN', 1],
    ]);

    const [relation] = (await tool(reader, 'list_wiki_relations', { page: remote.id })).data();
    expect((await tool(writer, 'remove_wiki_relation', { id: relation.id })).isError).toBe(false);
    expect((await tool(reader, 'list_wiki_relations', { page: remote.id })).data()).toHaveLength(1);

    const outsider = await token(people.outsider.cookie, ['read', 'wiki:write']);
    expect((await tool(outsider, 'list_wiki_relations', { page: remote.id })).text).toContain(
      'not_found',
    );
    expect((await tool(outsider, 'get_wiki_context', { issue: 'HELP-1' })).text).toContain(
      'not_found',
    );
    expect((await tool(outsider, 'get_wiki_context', { pages: [remote.id] })).data().pages).toEqual(
      [],
    );
  });
});
