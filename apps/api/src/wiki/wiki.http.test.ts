import type {
  AdminRole,
  AttachmentView,
  CreatedToken,
  InviteResponse,
  WikiFolder,
  WikiImportSourcePage,
  WikiImportView,
  WikiPageView,
  WikiRevision,
  WikiRevisionView,
  WikiSearchHit,
  WikiSpace,
  WikiTree,
} from '@ordler/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog, wikiImports, wikiPageRevisions } from '../db/schema.js';
import type { HttpFetch } from '../imports/sources/types.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];
const ids = {} as Record<'it' | 'finance' | 'help', string>;
type Person = 'anna' | 'boris' | 'teamOnly' | 'viewer' | 'outsider' | 'head';
const people = {} as Record<Person, { cookie: string; id: string }>;
let wikiJs: FakeWikiJs;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function person(name: Person, role: string, scope: object, teamIds: string[] = []) {
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name.toLowerCase()}@push30.test`,
      name,
      role: { roleId: roles.find((r) => r.key === role)!.id, scope },
      teamIds,
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

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const WIKI = 'https://wiki.push30.test';
const KEY = 'wikijs-api-key-0123456789abcdef';

interface FakePage extends WikiImportSourcePage {
  content: string;
  contentType: string;
  createdAt: string;
}

/** A Wiki.js GraphQL endpoint and file server in memory. */
class FakeWikiJs {
  pages: FakePage[] = [
    page(
      1,
      'home',
      'Home',
      'Start at [setup](/en/guides/setup) or [/guides/missing](/guides/missing).',
    ),
    page(2, 'guides/setup', 'Setup', 'Install it.\n\n![diagram](/uploads/diagram.png =300x)'),
    page(
      3,
      'guides/vpn/office',
      'Office VPN',
      '<h2>Connect</h2><p>Use <strong>WireGuard</strong>.</p>',
      'html',
    ),
    page(4, 'hr/leave', 'Leave policy', 'Not chosen'),
  ];
  calls: Array<{ url: string; authorization: string | undefined }> = [];

  fetch: HttpFetch = (url, init) => {
    this.calls.push({ url, authorization: init.headers.authorization });
    const respond = (status: number, json: unknown, body?: Buffer, type = 'application/json') =>
      Promise.resolve({
        status,
        headers: { get: (name: string) => (name === 'content-type' ? type : null) },
        json: () => Promise.resolve(json),
        arrayBuffer: () =>
          Promise.resolve(
            (body ?? Buffer.alloc(0)).buffer.slice(
              body?.byteOffset ?? 0,
              (body?.byteOffset ?? 0) + (body?.length ?? 0),
            ) as ArrayBuffer,
          ),
      });
    if (init.headers.authorization !== `Bearer ${KEY}`) {
      return respond(200, { errors: [{ message: 'Forbidden' }] });
    }
    if (url === `${WIKI}/graphql`) {
      const body = JSON.parse(init.body!) as { query: string; variables: { id?: number } };
      if (body.query.includes('list(')) {
        return respond(200, {
          data: {
            pages: {
              list: this.pages.map(({ id, path, locale, title, updatedAt }) => ({
                id,
                path,
                locale,
                title,
                updatedAt,
              })),
            },
          },
        });
      }
      const found = this.pages.find((p) => p.id === body.variables.id) ?? null;
      return respond(200, { data: { pages: { single: found } } });
    }
    if (url === `${WIKI}/uploads/diagram.png`) return respond(200, null, PNG, 'image/png');
    return respond(404, null);
  };
}

function page(id: number, path: string, title: string, content: string, contentType = 'markdown') {
  return {
    id,
    path,
    locale: 'en',
    title,
    content,
    contentType,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
  };
}

beforeEach(async () => {
  wikiJs = new FakeWikiJs();
  t = await createTestApp({ attachmentMaxBytes: 1024, wikiFetch: wikiJs.fetch });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const dept = async (name: string) =>
    (await call('POST', '/api/admin/departments', owner, { name })).json<{ id: string }>().id;
  ids.it = await dept('IT');
  ids.finance = await dept('Finance');
  ids.help = (
    await call('POST', `/api/admin/departments/${ids.it}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
      isPrivate: false,
    })
  ).json<{ id: string }>().id;
  await person('anna', 'member', { type: 'department', id: ids.it });
  await person('boris', 'member', { type: 'department', id: ids.it });
  await person('teamOnly', 'member', { type: 'team', id: ids.help }, [ids.help]);
  await person('viewer', 'viewer', { type: 'department', id: ids.it });
  await person('outsider', 'member', { type: 'department', id: ids.finance });
  await person('head', 'department_admin', { type: 'department', id: ids.it });
});
afterEach(() => t.close());

async function createPage(cookie: string, body: object = {}) {
  const response = await call('POST', '/api/wiki/pages', cookie, {
    department: ids.it,
    title: 'Printer setup',
    content: '# Printers\n\nAdd the **office** printer.',
    ...body,
  });
  expect(response.statusCode).toBe(201);
  return response.json<WikiPageView>();
}

describe('wiki spaces (SPEC §5.6)', () => {
  it('shows each department its own space; other departments and guests see nothing', async () => {
    const page = await createPage(people.anna.cookie);
    const spaces = async (cookie: string) =>
      (await call('GET', '/api/wiki/spaces', cookie)).json<WikiSpace[]>();
    expect(await spaces(people.anna.cookie)).toEqual([
      {
        department: { id: ids.it, name: 'IT' },
        visibility: 'department',
        pages: 1,
        canEdit: true,
        canManage: false,
      },
    ]);
    // A member of one team belongs to its department's knowledge too.
    expect((await spaces(people.teamOnly.cookie)).map((s) => s.department.name)).toEqual(['IT']);
    expect((await spaces(people.viewer.cookie))[0]).toMatchObject({ canEdit: false });
    expect(await spaces(people.outsider.cookie)).toEqual([
      expect.objectContaining({ department: { id: ids.finance, name: 'Finance' }, pages: 0 }),
    ]);
    expect((await spaces(owner)).map((s) => s.department.name)).toEqual(['Finance', 'IT']);

    expect(
      (await call('GET', `/api/wiki/pages/${page.id}`, people.outsider.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/api/wiki/spaces/${ids.it}`, people.outsider.cookie)).statusCode,
    ).toBe(404);
    const denied = await call('POST', '/api/wiki/pages', people.viewer.cookie, {
      department: ids.it,
      title: 'Nope',
    });
    expect(denied.statusCode).toBe(403);
    expect(
      (
        await call('POST', '/api/wiki/pages', people.outsider.cookie, {
          department: ids.it,
          title: 'Nope',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('opens a space to the whole organization only for its department admin', async () => {
    await createPage(people.anna.cookie, { title: 'Handbook' });
    const denied = await call('PATCH', `/api/wiki/spaces/${ids.it}`, people.anna.cookie, {
      visibility: 'organization',
    });
    expect(denied.statusCode).toBe(403);
    const opened = await call('PATCH', `/api/wiki/spaces/${ids.it}`, people.head.cookie, {
      visibility: 'organization',
    });
    expect(opened.json<WikiSpace>()).toMatchObject({ visibility: 'organization', canManage: true });

    const tree = (
      await call('GET', `/api/wiki/spaces/${ids.it}`, people.outsider.cookie)
    ).json<WikiTree>();
    expect(tree.pages.map((p) => p.title)).toEqual(['Handbook']);
    expect(tree.space).toMatchObject({ canEdit: false, canManage: false });
    const write = await call('POST', '/api/wiki/pages', people.outsider.cookie, {
      department: ids.it,
      title: 'Mine',
    });
    expect(write.statusCode).toBe(403);
    const [entry] = await t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'wiki.visibility_changed'));
    expect(entry).toMatchObject({ after: { visibility: 'organization' } });
  });

  it('nests folders, refuses cycles and deletes only empty folders', async () => {
    const folder = async (name: string, parentId?: string) =>
      (
        await call('POST', '/api/wiki/folders', people.anna.cookie, {
          department: ids.it,
          name,
          ...(parentId ? { parentId } : {}),
        })
      ).json<WikiFolder>();
    const guides = await folder('Guides');
    const network = await folder('Network', guides.id);
    const page = await createPage(people.anna.cookie, { folderId: network.id });
    expect(page.path.map((f) => f.name)).toEqual(['Guides', 'Network']);

    const cycle = await call('PATCH', `/api/wiki/folders/${guides.id}`, people.anna.cookie, {
      parentId: network.id,
    });
    expect(cycle.statusCode).toBe(400);
    const notEmpty = await call('DELETE', `/api/wiki/folders/${guides.id}`, people.anna.cookie);
    expect(notEmpty.json()).toEqual({ error: 'wiki_folder_not_empty' });

    const moved = await call('PATCH', `/api/wiki/pages/${page.id}`, people.anna.cookie, {
      folderId: null,
    });
    expect(moved.json<WikiPageView>()).toMatchObject({ folderId: null, path: [], version: 1 });
    expect(
      (await call('DELETE', `/api/wiki/folders/${network.id}`, people.anna.cookie)).statusCode,
    ).toBe(204);
    // A folder of another department is not a valid target.
    const other = (
      await call('POST', '/api/wiki/folders', people.outsider.cookie, {
        department: ids.finance,
        name: 'Budgets',
      })
    ).json<WikiFolder>();
    const foreign = await call('PATCH', `/api/wiki/pages/${page.id}`, people.anna.cookie, {
      folderId: other.id,
    });
    expect(foreign.statusCode).toBe(400);
  });

  it('keeps every version and refuses an edit based on an outdated one', async () => {
    const page = await createPage(people.anna.cookie);
    const first = await call('PATCH', `/api/wiki/pages/${page.id}`, people.boris.cookie, {
      content: 'Boris was here',
      baseVersion: 1,
    });
    expect(first.json<WikiPageView>()).toMatchObject({
      version: 2,
      content: 'Boris was here',
      updatedBy: { id: people.boris.id, name: 'boris' },
    });
    const stale = await call('PATCH', `/api/wiki/pages/${page.id}`, people.anna.cookie, {
      content: 'Anna overwrites',
      baseVersion: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'wiki_conflict' });

    const history = (
      await call('GET', `/api/wiki/pages/${page.id}/revisions`, people.viewer.cookie)
    ).json<WikiRevision[]>();
    expect(history.map((r) => [r.version, r.author?.name])).toEqual([
      [2, 'boris'],
      [1, 'anna'],
    ]);
    const old = (
      await call('GET', `/api/wiki/pages/${page.id}/revisions/1`, people.viewer.cookie)
    ).json<WikiRevisionView>();
    expect(old.content).toContain('office');
  });

  it('lets authors and department admins delete pages, keeping their history', async () => {
    const page = await createPage(people.anna.cookie);
    expect(
      (await call('DELETE', `/api/wiki/pages/${page.id}`, people.boris.cookie)).statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/api/wiki/pages/${page.id}`, people.anna.cookie)).statusCode,
    ).toBe(204);
    expect((await call('GET', `/api/wiki/pages/${page.id}`, people.anna.cookie)).statusCode).toBe(
      404,
    );
    const other = await createPage(people.boris.cookie, { title: 'Boris page' });
    expect(
      (await call('DELETE', `/api/wiki/pages/${other.id}`, people.head.cookie)).statusCode,
    ).toBe(204);
    const revisions = await t.ctx.db
      .select()
      .from(wikiPageRevisions)
      .where(eq(wikiPageRevisions.pageId, page.id));
    expect(revisions).toHaveLength(1);
  });

  it('finds pages by title or text only in readable spaces', async () => {
    await createPage(people.anna.cookie, {
      title: 'VPN',
      content: 'Use WireGuard 100% of the time',
    });
    await createPage(people.outsider.cookie, {
      department: ids.finance,
      title: 'Budget',
      content: 'WireGuard licences',
    });
    const search = async (cookie: string, q: string) =>
      (await call('GET', `/api/wiki/search?q=${encodeURIComponent(q)}`, cookie)).json<
        WikiSearchHit[]
      >();
    const hits = await search(people.anna.cookie, 'wireguard');
    expect(hits).toEqual([
      expect.objectContaining({ title: 'VPN', snippet: 'Use WireGuard 100% of the time' }),
    ]);
    expect(await search(people.anna.cookie, '100%')).toHaveLength(1);
    expect(await search(people.anna.cookie, '0%x')).toHaveLength(0);
    expect((await search(owner, 'wireguard')).map((h) => h.title).sort()).toEqual([
      'Budget',
      'VPN',
    ]);
    // The global search (Cmd+K) lists the same readable pages.
    const global = async (cookie: string) =>
      (await call('GET', '/api/search?q=wireguard', cookie)).json<{ wikiPages: WikiSearchHit[] }>()
        .wikiPages;
    expect((await global(people.anna.cookie)).map((h) => h.title)).toEqual(['VPN']);
    expect((await global(owner)).map((h) => h.title).sort()).toEqual(['Budget', 'VPN']);
  });

  it('stores pasted files with the department and serves them to its readers only', async () => {
    const boundary = '----ordler-test';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = (cookie: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/wiki/spaces/${ids.it}/files`,
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
    expect((await upload(people.viewer.cookie)).statusCode).toBe(403);
    const stored = await upload(people.anna.cookie);
    expect(stored.statusCode).toBe(201);
    const file = stored.json<AttachmentView>();
    expect(file.isImage).toBe(true);
    expect((await call('GET', file.url, people.viewer.cookie)).statusCode).toBe(200);
    expect((await call('GET', file.url, people.outsider.cookie)).statusCode).toBe(404);
  });
});

describe('import from Wiki.js (ADR 0017)', () => {
  async function connect(cookie = people.head.cookie, token = KEY) {
    return call('POST', '/api/wiki/imports', cookie, {
      department: ids.it,
      baseUrl: `${WIKI}/en/home`,
      token,
    });
  }

  it('is for department admins and checks the key without keeping it in clear', async () => {
    expect((await connect(people.anna.cookie)).statusCode).toBe(403);
    const refused = await connect(people.head.cookie, 'wrong-key-0123456789abcdef');
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: 'import_auth_failed' });
    const plain = await call('POST', '/api/wiki/imports', people.head.cookie, {
      department: ids.it,
      baseUrl: 'http://wiki.push30.test',
      token: KEY,
    });
    expect(plain.statusCode).toBe(400);

    const connected = await connect();
    expect(connected.statusCode).toBe(201);
    const run = connected.json<WikiImportView>();
    expect(run).toMatchObject({ baseUrl: WIKI, status: 'draft' });
    expect(connected.body).not.toContain(KEY);
    const [row] = await t.ctx.db.select().from(wikiImports).where(eq(wikiImports.id, run.id));
    expect(row!.tokenEncrypted).not.toContain(KEY);
    const pages = (await call('GET', `/api/wiki/imports/${run.id}/pages`, people.head.cookie)).json<
      WikiImportSourcePage[]
    >();
    expect(pages.map((p) => p.path)).toEqual([
      'home',
      'guides/setup',
      'guides/vpn/office',
      'hr/leave',
    ]);
  });

  it('imports chosen pages and folders with their tree, files and links, and re-runs safely', async () => {
    const run = (await connect()).json<WikiImportView>();
    const started = await call('POST', `/api/wiki/imports/${run.id}/start`, people.head.cookie, {
      paths: ['guides'],
      pageIds: [1],
    });
    expect(started.json<WikiImportView>()).toMatchObject({ status: 'running', total: 3 });
    await t.ctx.wikiImports.runToCompletion(run.id);
    const done = (
      await call('GET', `/api/wiki/imports/${run.id}`, people.head.cookie)
    ).json<WikiImportView>();
    expect(done).toMatchObject({
      status: 'completed',
      counts: { imported: 3, updated: 0, skipped: 0, failed: 0, files: 1 },
    });
    const [row] = await t.ctx.db.select().from(wikiImports).where(eq(wikiImports.id, run.id));
    expect(row!.tokenEncrypted).toBeNull();

    const tree = (
      await call('GET', `/api/wiki/spaces/${ids.it}`, people.anna.cookie)
    ).json<WikiTree>();
    expect(tree.folders.map((f) => f.name).sort()).toEqual(['guides', 'vpn']);
    expect(tree.pages.map((p) => p.title).sort()).toEqual(['Home', 'Office VPN', 'Setup']);
    const byTitle = (title: string) => tree.pages.find((p) => p.title === title)!;
    const home = (
      await call('GET', `/api/wiki/pages/${byTitle('Home').id}`, people.anna.cookie)
    ).json<WikiPageView>();
    expect(home.content).toBe(
      `Start at [setup](/wiki/page/${byTitle('Setup').id}) or [/guides/missing](/guides/missing).`,
    );
    const setup = (
      await call('GET', `/api/wiki/pages/${byTitle('Setup').id}`, people.anna.cookie)
    ).json<WikiPageView>();
    expect(setup.path.map((f) => f.name)).toEqual(['guides']);
    expect(setup.content).toMatch(/!\[diagram\]\(\/api\/attachments\/[0-9a-f-]+\/diagram\.png\)$/);
    const image = /\((\/api\/attachments\/[^)]+)\)/.exec(setup.content)![1]!;
    expect((await call('GET', image, people.anna.cookie)).statusCode).toBe(200);
    const vpn = (
      await call('GET', `/api/wiki/pages/${byTitle('Office VPN').id}`, people.anna.cookie)
    ).json<WikiPageView>();
    expect(vpn.content).toBe('## Connect\n\nUse **WireGuard**.');
    expect(vpn.path.map((f) => f.name)).toEqual(['guides', 'vpn']);
    // The key went to the wiki only, never anywhere else.
    expect(wikiJs.calls.every((c) => c.url.startsWith(WIKI))).toBe(true);

    // Second run: one page changed upstream, the rest is skipped; nothing is duplicated.
    wikiJs.pages[1] = {
      ...wikiJs.pages[1]!,
      content: 'Install it twice.',
      updatedAt: '2025-03-01T00:00:00.000Z',
    };
    const again = (await connect()).json<WikiImportView>();
    await call('POST', `/api/wiki/imports/${again.id}/start`, people.head.cookie, {
      paths: ['guides'],
      pageIds: [1],
    });
    await t.ctx.wikiImports.runToCompletion(again.id);
    const second = (
      await call('GET', `/api/wiki/imports/${again.id}`, people.head.cookie)
    ).json<WikiImportView>();
    expect(second.counts).toMatchObject({ imported: 0, updated: 1, skipped: 2 });
    const after = (
      await call('GET', `/api/wiki/spaces/${ids.it}`, people.anna.cookie)
    ).json<WikiTree>();
    expect(after.pages).toHaveLength(3);
    expect(after.pages.find((p) => p.title === 'Setup')!.version).toBe(2);
  });

  it('cancel stops the import and erases the key', async () => {
    const run = (await connect()).json<WikiImportView>();
    const canceled = await call('POST', `/api/wiki/imports/${run.id}/cancel`, people.head.cookie);
    expect(canceled.json<WikiImportView>().status).toBe('canceled');
    const [row] = await t.ctx.db
      .select()
      .from(wikiImports)
      .where(and(eq(wikiImports.id, run.id), eq(wikiImports.status, 'canceled')));
    expect(row!.tokenEncrypted).toBeNull();
    expect(
      (
        await call('POST', `/api/wiki/imports/${run.id}/start`, people.head.cookie, {
          paths: ['hr'],
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('MCP wiki tools (SPEC §10.1)', () => {
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

  it('lets an agent write, find and read pages exactly as its member', async () => {
    const readOnly = await token(people.anna.cookie, ['read']);
    const refused = await tool(readOnly, 'create_wiki_page', { department: 'IT', title: 'X' });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain('wiki:write');

    const writer = await token(people.anna.cookie, ['read', 'wiki:write']);
    const created = await tool(writer, 'create_wiki_page', {
      department: 'it',
      folder: 'Runbooks/Network',
      title: 'Restart the router',
      content: 'Unplug it for **10 seconds**.',
    });
    expect(created.isError).toBe(false);
    const page = created.data();
    expect(page).toMatchObject({
      title: 'Restart the router',
      department: 'IT',
      folder: 'Runbooks/Network',
      version: 1,
    });

    const updated = await tool(writer, 'update_wiki_page', {
      id: page.id,
      content: 'Unplug it for 30 seconds.',
      baseVersion: 1,
    });
    expect(updated.data()).toMatchObject({ version: 2 });
    const stale = await tool(writer, 'update_wiki_page', {
      id: page.id,
      content: 'x',
      baseVersion: 1,
    });
    expect(stale.text).toContain('wiki_conflict');

    const found = await tool(readOnly, 'search_wiki', { query: 'unplug' });
    expect(found.data()).toEqual([
      expect.objectContaining({ id: page.id, resource: `ordler://wiki/${page.id}` }),
    ]);
    const tree = await tool(readOnly, 'list_wiki_pages', { department: 'IT' });
    expect(tree.data()).toMatchObject({
      folders: ['Runbooks', 'Runbooks/Network'],
      pages: [expect.objectContaining({ folder: 'Runbooks/Network' })],
    });
    const spaces = await tool(readOnly, 'list_wiki_spaces');
    expect(spaces.data()).toEqual([expect.objectContaining({ department: 'IT', pages: 1 })]);

    const outsider = await token(people.outsider.cookie, ['read', 'wiki:write']);
    expect((await tool(outsider, 'get_wiki_page', { id: page.id })).text).toContain('not_found');
    expect(
      (await tool(outsider, 'create_wiki_page', { department: 'IT', title: 'Sneaky' })).text,
    ).toContain('not_found');

    const drawer = await token(people.anna.cookie, ['read', 'issues:write', 'wiki:write']);
    const diagram = await tool(drawer, 'create_whiteboard', {
      team: 'HELP',
      title: 'Router flow',
      wikiPage: page.id,
      nodes: [
        { id: 'a', label: 'Unplug' },
        { id: 'b', label: 'Wait' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });
    expect(diagram.isError).toBe(false);
    const boardId = diagram.data().id as string;
    const embedded = (await tool(readOnly, 'get_wiki_page', { id: page.id })).data();
    expect(embedded.content).toBe(
      `Unplug it for 30 seconds.\n\n[Router flow](/whiteboards/${boardId})\n`,
    );
    expect(embedded.whiteboards).toEqual([
      { id: boardId, resource: `ordler://whiteboard/${boardId}` },
    ]);
    // Embedding the same board again changes nothing; without wiki:write it is refused up front.
    await tool(drawer, 'embed_whiteboard_in_wiki', { id: boardId, page: page.id });
    expect((await tool(readOnly, 'get_wiki_page', { id: page.id })).data().version).toBe(3);
    const issuesOnly = await token(people.anna.cookie, ['read', 'issues:write']);
    const refusedEmbed = await tool(issuesOnly, 'create_whiteboard', {
      team: 'HELP',
      title: 'Orphan',
      wikiPage: page.id,
    });
    expect(refusedEmbed.text).toContain('forbidden');
    const boards = (await call('GET', '/api/whiteboards', people.anna.cookie)).json<
      Array<{ title: string }>
    >();
    expect(boards.map((b) => b.title)).toEqual(['Router flow']);

    const audited = await t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'wiki.page_created'));
    expect(audited[0]).toMatchObject({ after: { title: 'Restart the router', via: 'Claude' } });
  });
});
