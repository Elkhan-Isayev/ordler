import type {
  AdminRole,
  InviteResponse,
  WhiteboardFile,
  WhiteboardScene,
  WhiteboardSummary,
  WhiteboardView,
} from '@ordler/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog, whiteboards } from '../db/schema.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];
type Person = 'anna' | 'boris' | 'lead' | 'viewer' | 'outsider';
const people = {} as Record<Person, { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object | string) {
  return t.app.inject({
    method,
    url,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(typeof payload === 'string' ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload ? { payload } : {}),
  });
}

async function person(name: Person, role: string, departmentId: string) {
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name}@push30.test`,
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

/** A minimal element as the editor sends it; the server keeps unknown fields untouched. */
function element(id: string, version: number, versionNonce: number, extra: object = {}) {
  return {
    id,
    type: 'rectangle',
    version,
    versionNonce,
    isDeleted: false,
    x: version * 10,
    y: 0,
    width: 100,
    height: 50,
    index: 'a0',
    ...extra,
  };
}

async function board(cookie = people.anna.cookie, title = 'Network map') {
  const created = await call('POST', '/api/whiteboards', cookie, { team: 'HELP', title });
  expect(created.statusCode).toBe(201);
  return created.json<WhiteboardView>();
}

const save = (cookie: string, id: string, elements: object[]) =>
  call('POST', `/api/whiteboards/${id}/scene`, cookie, { elements });
const scene = async (cookie: string, id: string, since = 0) =>
  (
    await call('GET', `/api/whiteboards/${id}/scene?since=${since}`, cookie)
  ).json<WhiteboardScene>();

beforeEach(async () => {
  t = await createTestApp({ attachmentMaxBytes: 1024 });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const dept = async (name: string) =>
    (await call('POST', '/api/admin/departments', owner, { name })).json<{ id: string }>().id;
  const itId = await dept('IT');
  const financeId = await dept('Finance');
  await call('POST', `/api/admin/departments/${itId}/teams`, owner, {
    name: 'Helpdesk',
    key: 'HELP',
    isPrivate: false,
  });
  await person('anna', 'member', itId);
  await person('boris', 'member', itId);
  await person('lead', 'team_lead', itId);
  await person('viewer', 'viewer', itId);
  await person('outsider', 'member', financeId);
  await call('POST', '/api/teams/HELP/issues', owner, { title: 'Office network' });
});
afterEach(() => t.close());

describe('whiteboards (SPEC §5.5)', () => {
  it('lets members with whiteboard.edit create boards everyone in the team can read', async () => {
    const created = await board();
    expect(created).toMatchObject({
      title: 'Network map',
      team: { key: 'HELP' },
      createdBy: { id: people.anna.id, name: 'anna' },
      canEdit: true,
      canManage: true,
      issues: [],
    });

    const seen = (await call('GET', '/api/whiteboards', people.viewer.cookie)).json<
      WhiteboardSummary[]
    >();
    expect(seen.map((b) => b.id)).toEqual([created.id]);
    expect(seen[0]).toMatchObject({ canEdit: false, canManage: false });
    const flag = async (cookie: string) =>
      (await call('GET', '/api/teams', cookie)).json<Array<{ whiteboards: boolean }>>()[0]!
        .whiteboards;
    expect(await flag(people.anna.cookie)).toBe(true);
    expect(await flag(people.viewer.cookie)).toBe(false);
    const byTeam = await call('GET', '/api/whiteboards?team=help', people.boris.cookie);
    expect(byTeam.json<WhiteboardSummary[]>()[0]).toMatchObject({
      canEdit: true,
      canManage: false,
    });
  });

  it('refuses creation without whiteboard.edit and hides boards from other departments', async () => {
    const refused = await call('POST', '/api/whiteboards', people.viewer.cookie, {
      team: 'HELP',
      title: 'Nope',
    });
    expect(refused.statusCode).toBe(403);
    expect(
      (await call('POST', '/api/whiteboards', people.outsider.cookie, { team: 'HELP', title: 'x' }))
        .statusCode,
    ).toBe(404);

    const created = await board();
    expect((await call('GET', '/api/whiteboards', people.outsider.cookie)).json()).toEqual([]);
    expect(
      (await call('GET', `/api/whiteboards/${created.id}`, people.outsider.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/api/whiteboards/${created.id}/scene`, people.outsider.cookie))
        .statusCode,
    ).toBe(404);
    expect((await save(people.outsider.cookie, created.id, [element('a', 1, 1)])).statusCode).toBe(
      404,
    );
    expect((await call('GET', '/api/whiteboards/not-a-uuid', people.anna.cookie)).statusCode).toBe(
      404,
    );
  });

  it('lets the creator and team leads rename and delete, not other members', async () => {
    const created = await board();
    const rename = (cookie: string, title: string) =>
      call('PATCH', `/api/whiteboards/${created.id}`, cookie, { title });
    expect((await rename(people.boris.cookie, 'Mine now')).statusCode).toBe(403);
    expect((await rename(people.viewer.cookie, 'Mine now')).statusCode).toBe(403);
    expect((await rename(people.anna.cookie, 'Office network')).json<WhiteboardView>().title).toBe(
      'Office network',
    );
    expect((await rename(people.lead.cookie, 'Office LAN')).statusCode).toBe(200);

    expect(
      (await call('DELETE', `/api/whiteboards/${created.id}`, people.boris.cookie)).statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/api/whiteboards/${created.id}`, people.lead.cookie)).statusCode,
    ).toBe(204);
    expect(
      (await call('GET', `/api/whiteboards/${created.id}`, people.anna.cookie)).statusCode,
    ).toBe(404);
    expect((await call('GET', '/api/whiteboards', people.anna.cookie)).json()).toEqual([]);

    const audited = await t.ctx.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.targetType, 'whiteboard'), eq(auditLog.targetId, created.id)));
    expect(audited.map((a) => a.action).sort()).toEqual([
      'whiteboard.created',
      'whiteboard.deleted',
      'whiteboard.renamed',
      'whiteboard.renamed',
    ]);
  });
});

describe('whiteboard scene sync (ADR 0015)', () => {
  it('stores elements and converges on the higher version, ties to the lower nonce', async () => {
    const { id } = await board();
    const first = await save(people.anna.cookie, id, [
      element('box', 2, 500),
      element('note', 1, 7),
    ]);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ seq: 1, accepted: expect.arrayContaining(['box', 'note']) });

    // Boris edited an older copy: his version loses, his tie with a lower nonce wins.
    const second = await save(people.boris.cookie, id, [
      element('box', 1, 1),
      element('note', 1, 3, { x: 999 }),
    ]);
    expect(second.json()).toEqual({ seq: 2, accepted: ['note'] });
    const third = await save(people.anna.cookie, id, [element('note', 1, 9, { x: 5 })]);
    expect(third.json()).toEqual({ seq: 3, accepted: [] });

    const full = await scene(people.viewer.cookie, id);
    expect(full.seq).toBe(3);
    const byId = Object.fromEntries(full.elements.map((e) => [e.id, e]));
    expect(byId.box).toMatchObject({ version: 2, versionNonce: 500, x: 20, width: 100 });
    expect(byId.note).toMatchObject({ version: 1, versionNonce: 3, x: 999 });
  });

  it('catches tabs up with deletions, while a full load leaves deleted elements out', async () => {
    const { id } = await board();
    await save(people.anna.cookie, id, [element('a', 1, 1), element('b', 1, 1)]);
    await save(people.anna.cookie, id, [element('a', 2, 1, { isDeleted: true })]);

    expect((await scene(people.anna.cookie, id)).elements.map((e) => e.id)).toEqual(['b']);
    const since = await scene(people.anna.cookie, id, 1);
    expect(since).toMatchObject({ seq: 2, elements: [{ id: 'a', isDeleted: true }] });
  });

  it('refuses drawing without whiteboard.edit and malformed elements', async () => {
    const { id } = await board();
    expect((await save(people.viewer.cookie, id, [element('a', 1, 1)])).statusCode).toBe(403);
    expect((await save(people.anna.cookie, id, [{ id: 'a', type: 'rectangle' }])).statusCode).toBe(
      400,
    );
    expect((await save(people.anna.cookie, id, [element('bad id!', 1, 1)])).statusCode).toBe(400);
    expect((await save(people.anna.cookie, id, [])).statusCode).toBe(400);
    expect(
      (await call('POST', `/api/whiteboards/${id}/scene`, people.anna.cookie, '{oops')).statusCode,
    ).toBe(400);
    const anonymous = await call('POST', `/api/whiteboards/${id}/scene`, undefined, {
      elements: [element('a', 1, 1)],
    });
    expect(anonymous.statusCode).toBe(401);
    const forged = await t.app.inject({
      method: 'POST',
      url: `/api/whiteboards/${id}/scene`,
      headers: { cookie: people.anna.cookie, origin: 'https://evil.test' },
      payload: { elements: [element('a', 1, 1)] },
    });
    expect(forged.statusCode).toBe(403);
    expect((await scene(people.anna.cookie, id)).elements).toEqual([]);
  });

  it('accepts saves larger than the default body limit', async () => {
    const { id } = await board();
    const points = Array.from({ length: 20_000 }, (_, i) => [i, i * 2]);
    const strokes = Array.from({ length: 6 }, (_, i) =>
      element(`stroke${i}`, 1, 1, { type: 'freedraw', points }),
    );
    const saved = await save(people.anna.cookie, id, strokes);
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ accepted: string[] }>().accepted).toHaveLength(6);
  });

  it('stops a board from growing past its element limit', async () => {
    const { id } = await board();
    await save(people.anna.cookie, id, [element('a', 1, 1)]);
    await t.ctx.db.update(whiteboards).set({ elementCount: 19_999 }).where(eq(whiteboards.id, id));
    // Changing an existing element is always allowed; adding new ones past the limit is not.
    expect(
      (await save(people.anna.cookie, id, [element('a', 2, 1), element('b', 1, 1)])).statusCode,
    ).toBe(200);
    const full = await save(people.anna.cookie, id, [element('c', 1, 1)]);
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({ error: 'whiteboard_full' });
  });
});

describe('whiteboard images', () => {
  const png = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

  it('stores images for editors and serves them to readers', async () => {
    const { id } = await board();
    const upload = (cookie: string, body: object) =>
      call('POST', `/api/whiteboards/${id}/files`, cookie, body);
    expect(
      (await upload(people.anna.cookie, { id: 'f1', mimeType: 'image/png', dataURL: png }))
        .statusCode,
    ).toBe(204);
    // Content-addressed ids: a second upload of the same file is accepted and changes nothing.
    expect(
      (await upload(people.boris.cookie, { id: 'f1', mimeType: 'image/png', dataURL: png }))
        .statusCode,
    ).toBe(204);
    expect(
      (await upload(people.viewer.cookie, { id: 'f2', mimeType: 'image/png', dataURL: png }))
        .statusCode,
    ).toBe(403);
    expect(
      (await upload(people.anna.cookie, { id: 'f3', mimeType: 'image/jpeg', dataURL: png }))
        .statusCode,
    ).toBe(400);
    expect(
      (await upload(people.anna.cookie, { id: 'f4', mimeType: 'text/html', dataURL: png }))
        .statusCode,
    ).toBe(400);
    const big = `data:image/png;base64,${Buffer.alloc(2048).toString('base64')}`;
    expect(
      (await upload(people.anna.cookie, { id: 'f5', mimeType: 'image/png', dataURL: big }))
        .statusCode,
    ).toBe(413);

    const files = (
      await call('GET', `/api/whiteboards/${id}/files?ids=f1,f2,../x`, people.viewer.cookie)
    ).json<WhiteboardFile[]>();
    expect(files).toEqual([
      { id: 'f1', mimeType: 'image/png', dataURL: png, created: expect.any(Number) },
    ]);
    expect(
      (await call('GET', `/api/whiteboards/${id}/files?ids=f1`, people.outsider.cookie)).statusCode,
    ).toBe(404);
  });
});

describe('whiteboards on issues', () => {
  it('attaches boards to issues for members who may change the issue', async () => {
    const { id } = await board();
    const attach = (cookie: string) =>
      call('POST', '/api/issues/HELP-1/whiteboards', cookie, { whiteboardId: id });
    expect((await attach(people.viewer.cookie)).statusCode).toBe(403);
    expect((await attach(people.outsider.cookie)).statusCode).toBe(404);
    const attached = await attach(people.boris.cookie);
    expect(attached.statusCode).toBe(201);
    expect(attached.json<WhiteboardSummary[]>().map((b) => b.id)).toEqual([id]);
    // Attaching twice keeps one link.
    expect((await attach(people.boris.cookie)).json<WhiteboardSummary[]>()).toHaveLength(1);

    const listed = (await call('GET', '/api/issues/HELP-1/whiteboards', people.viewer.cookie)).json<
      WhiteboardSummary[]
    >();
    expect(listed).toMatchObject([{ id, title: 'Network map' }]);
    const view = (
      await call('GET', `/api/whiteboards/${id}`, people.viewer.cookie)
    ).json<WhiteboardView>();
    expect(view.issues).toEqual([{ identifier: 'HELP-1', title: 'Office network' }]);

    expect(
      (await call('DELETE', `/api/issues/HELP-1/whiteboards/${id}`, people.viewer.cookie))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/api/issues/HELP-1/whiteboards/${id}`, people.anna.cookie)).statusCode,
    ).toBe(204);
    expect(
      (await call('GET', '/api/issues/HELP-1/whiteboards', people.anna.cookie)).json(),
    ).toEqual([]);
    expect(
      (await call('DELETE', `/api/issues/HELP-1/whiteboards/${id}`, people.anna.cookie)).statusCode,
    ).toBe(404);
  });

  it('creates a board straight on an issue, and refuses before creating when it may not', async () => {
    const created = await call('POST', '/api/whiteboards', people.anna.cookie, {
      team: 'HELP',
      title: 'Rack layout',
      issue: 'HELP-1',
    });
    expect(created.json<WhiteboardView>().issues).toEqual([
      { identifier: 'HELP-1', title: 'Office network' },
    ]);
    const missing = await call('POST', '/api/whiteboards', people.anna.cookie, {
      team: 'HELP',
      title: 'Orphan',
      issue: 'HELP-99',
    });
    expect(missing.statusCode).toBe(404);
    const titles = (await call('GET', '/api/whiteboards', people.anna.cookie))
      .json<WhiteboardSummary[]>()
      .map((b) => b.title);
    expect(titles).toEqual(['Rack layout']);
  });

  it('leaves deleted boards off the issue', async () => {
    const created = (
      await call('POST', '/api/whiteboards', people.anna.cookie, {
        team: 'HELP',
        title: 'Old sketch',
        issue: 'HELP-1',
      })
    ).json<WhiteboardView>();
    await call('DELETE', `/api/whiteboards/${created.id}`, people.anna.cookie);
    expect(
      (await call('GET', '/api/issues/HELP-1/whiteboards', people.anna.cookie)).json(),
    ).toEqual([]);
  });
});
