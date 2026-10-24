import type {
  AdminRole,
  ImportContainer,
  ImportDryRun,
  ImportOptions,
  ImportRunView,
  InviteResponse,
  IssueDetail,
  TeamView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { importRuns } from '../db/schema.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import type { SourceCredentials } from './sources/index.js';
import { SourceError, type ExternalIssue, type ImportSourceAdapter } from './sources/types.js';

const CONTAINER: ImportContainer = {
  id: 'lin-team',
  key: 'ENG',
  name: 'Engineering',
  statuses: [
    { name: 'Todo', category: 'unstarted' },
    { name: 'Doing', category: 'started' },
    { name: 'Shipped', category: 'completed' },
  ],
};
const UPLOAD = 'https://uploads.linear.app/a/b/shot.png';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function external(n: number, overrides: Partial<ExternalIssue> = {}): ExternalIssue {
  return {
    externalId: `ext-${n}`,
    key: `ENG-${n}`,
    url: `https://linear.app/acme/issue/ENG-${n}`,
    title: `Issue ${n}`,
    description: '',
    status: { name: 'Todo', category: 'unstarted' },
    priority: 'none',
    assignees: [],
    creator: null,
    labels: [],
    dueDate: null,
    createdAt: `2026-01-0${n}T10:00:00.000Z`,
    updatedAt: `2026-01-0${n}T10:00:00.000Z`,
    parentExternalId: null,
    comments: [],
    attachments: [],
    dropped: [],
    ...overrides,
  };
}

/** An in-memory source: pages of two issues; `failWith` makes the next page call fail. */
class FakeSource implements ImportSourceAdapter {
  issues: ExternalIssue[] = [];
  tokens: string[] = [];
  failWith: SourceError | undefined;

  constructor(private readonly validToken = 'lin_api_valid_token') {}

  bind(credentials: SourceCredentials): ImportSourceAdapter {
    this.tokens.push(credentials.token);
    return {
      account: async () => {
        if (credentials.token !== this.validToken) {
          throw new SourceError('import_auth_failed', 'bad key');
        }
        return { name: 'Linear Admin', email: 'admin@acme.test' };
      },
      containers: () => this.containers(),
      people: () => this.people(),
      page: (c, cursor) => this.page(c, cursor),
      download: (url) => this.download(url),
    };
  }

  account() {
    return Promise.resolve({ name: 'Linear Admin', email: null });
  }

  containers() {
    return Promise.resolve([CONTAINER]);
  }

  people() {
    return Promise.resolve([
      { id: 'dev@push30.test', name: 'Dev', email: 'dev@push30.test' },
      { id: 'Ghost', name: 'Ghost', email: null },
    ]);
  }

  page(_container: ImportContainer, cursor: string | null) {
    if (this.failWith) return Promise.reject(this.failWith);
    const start = Number(cursor ?? 0);
    const next = start + 2 < this.issues.length ? String(start + 2) : null;
    return Promise.resolve({ issues: this.issues.slice(start, start + 2), next });
  }

  download(url: string) {
    if (url !== UPLOAD) return Promise.reject(new SourceError('import_source_failed', 'gone'));
    return Promise.resolve({ data: PNG, contentType: 'image/png' });
  }
}

let t: TestApp;
let owner: string;
let source: FakeSource;
const ids = {} as Record<'it' | 'help', string>;
const people = {} as Record<'dev' | 'peer', { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PUT';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

beforeEach(async () => {
  source = new FakeSource();
  t = await createTestApp({ importSources: (c) => source.bind(c) });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  ids.it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>().id;
  ids.help = (
    await call('POST', `/api/admin/departments/${ids.it}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
      isPrivate: false,
    })
  ).json<{ id: string }>().id;
  for (const name of ['dev', 'peer'] as const) {
    const invite = (
      await call('POST', '/api/admin/members', owner, {
        email: `${name}@push30.test`,
        name,
        role: {
          roleId: roles.find((r) => r.key === 'member')!.id,
          scope: { type: 'department', id: ids.it },
        },
        teamIds: name === 'peer' ? [ids.help] : [],
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
});
afterEach(() => t.close());

async function connect(): Promise<ImportRunView> {
  const response = await call('POST', '/api/admin/imports', owner, {
    source: 'linear',
    token: 'lin_api_valid_token',
  });
  expect(response.statusCode).toBe(201);
  return response.json<ImportRunView>();
}

async function configure(runId: string, extra: object = {}) {
  return call('PUT', `/api/admin/imports/${runId}/config`, owner, {
    containers: [{ externalId: 'lin-team', teamId: ids.help }],
    peopleMap: { 'dev@push30.test': people.dev.id, Ghost: null },
    ...extra,
  });
}

async function runImport(extra: object = {}): Promise<ImportRunView> {
  const run = await connect();
  expect((await configure(run.id, extra)).statusCode).toBe(200);
  expect((await call('POST', `/api/admin/imports/${run.id}/start`, owner)).statusCode).toBe(201);
  return t.ctx.imports.runToCompletion(run.id);
}

const issue = async (identifier: string, cookie = owner) =>
  (await call('GET', `/api/issues/${identifier}`, cookie)).json<IssueDetail>();

describe('import from Linear and Jira (SPEC §10.2)', () => {
  it('is for organization admins only and never returns the token', async () => {
    const denied = await call('POST', '/api/admin/imports', people.dev.cookie, {
      source: 'linear',
      token: 'lin_api_valid_token',
    });
    expect(denied.statusCode).toBe(403);
    expect((await call('GET', '/api/admin/imports', people.dev.cookie)).statusCode).toBe(403);

    const rejected = await call('POST', '/api/admin/imports', owner, {
      source: 'linear',
      token: 'lin_api_wrong_token',
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toEqual({ error: 'import_auth_failed' });

    const run = await connect();
    expect(run.account.name).toBe('Linear Admin');
    const listed = await call('GET', '/api/admin/imports', owner);
    expect(listed.body).not.toContain('lin_api_valid_token');
    const [row] = await t.ctx.db.select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(row!.tokenEncrypted).not.toContain('lin_api_valid_token');
  });

  it('suggests Ordler members by email and checks the mapping', async () => {
    const run = await connect();
    const options = (
      await call('GET', `/api/admin/imports/${run.id}/options`, owner)
    ).json<ImportOptions>();
    expect(options.containers[0]!.key).toBe('ENG');
    expect(options.people).toEqual([
      expect.objectContaining({ id: 'dev@push30.test', suggestedMemberId: people.dev.id }),
      expect.objectContaining({ id: 'Ghost', suggestedMemberId: null }),
    ]);
    const bad = await configure(run.id, {
      peopleMap: { Ghost: '00000000-0000-4000-8000-000000000000' },
    });
    expect(bad.statusCode).toBe(404);
    const neither = await call('PUT', `/api/admin/imports/${run.id}/config`, owner, {
      containers: [{ externalId: 'lin-team' }],
    });
    expect(neither.statusCode).toBe(400);
  });

  it('dry-runs without writing anything', async () => {
    source.issues = [
      external(1, { assignees: [{ id: 'stranger@x.test', name: 'S', email: 'stranger@x.test' }] }),
      external(2, { dropped: ['estimate'] }),
      external(3),
    ];
    const run = await connect();
    await configure(run.id);
    const dry = (
      await call('POST', `/api/admin/imports/${run.id}/dry-run`, owner)
    ).json<ImportDryRun>();
    expect(dry.containers).toEqual([
      { externalId: 'lin-team', name: 'Engineering', issues: 3, comments: 0, attachments: 0 },
    ]);
    expect(dry.unmappedPeople).toEqual(['stranger@x.test']);
    expect(dry.warnings).toEqual(['estimate']);
    const team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
    expect(team).toBeDefined();
    expect((await call('GET', '/api/issues/HELP-1', owner)).statusCode).toBe(404);
  });

  it('imports issues with history, people, labels, files and sub-issues — and tells nobody', async () => {
    source.issues = [
      // The sub-issue comes first, so its parent arrives on a later page.
      external(1, { parentExternalId: 'ext-3', title: 'Child' }),
      external(2, {
        title: 'Login broken',
        description: `Steps\n\n![shot](${UPLOAD})`,
        status: { name: 'Doing', category: 'started' },
        priority: 'high',
        assignees: [{ id: 'dev@push30.test', name: 'Dev', email: 'dev@push30.test' }],
        creator: { id: 'Ghost', name: 'Ghost', email: null },
        labels: ['bug', 'Bug', 'backend'],
        dueDate: '2026-02-01',
        comments: [
          {
            externalId: 'c1',
            author: { id: 'dev@push30.test', name: 'Dev', email: 'dev@push30.test' },
            body: 'Looking',
            createdAt: '2026-01-02T11:00:00.000Z',
          },
          {
            externalId: 'c2',
            author: { id: 'Ghost', name: 'Ghost', email: null },
            body: 'Thanks',
            createdAt: '2026-01-02T12:00:00.000Z',
          },
        ],
        attachments: [
          { ref: UPLOAD, filename: 'shot.png', url: UPLOAD, size: PNG.length },
          { ref: 'https://uploads.linear.app/gone.txt', filename: 'gone.txt', url: 'x', size: 1 },
        ],
      }),
      external(3, { title: 'Parent' }),
    ];
    const done = await runImport();
    expect(done.status).toBe('completed');
    expect(done.counts).toMatchObject({ imported: 3, failed: 0, comments: 2, attachments: 1 });
    expect(done.report.map((r) => [r.key, r.identifier])).toEqual([
      ['ENG-1', 'HELP-1'],
      ['ENG-2', 'HELP-2'],
      ['ENG-3', 'HELP-3'],
    ]);

    const login = await issue('HELP-2');
    expect(login).toMatchObject({
      title: 'Login broken',
      priority: 'high',
      dueDate: '2026-02-01',
      status: { category: 'started' },
      createdAt: '2026-01-02T10:00:00.000Z',
      assignees: [{ id: people.dev.id }],
    });
    expect(login.labels.map((l) => l.name).sort()).toEqual(['backend', 'bug']);
    expect(login.description).toMatch(/!\[shot\]\(\/api\/attachments\/[0-9a-f-]+\/shot\.png\)/);
    expect(login.description).not.toContain('uploads.linear.app');
    expect(login.comments.map((c) => [c.author?.id ?? null, c.body])).toEqual([
      [people.dev.id, 'Looking'],
      [null, '**Ghost** · Linear\n\nThanks'],
    ]);
    expect(login.events).toEqual([
      expect.objectContaining({
        kind: 'created',
        changes: {
          imported: {
            from: null,
            to: { source: 'linear', key: 'ENG-2', url: 'https://linear.app/acme/issue/ENG-2' },
          },
        },
      }),
    ]);
    // The mapped assignee joined the team.
    expect((await call('GET', '/api/teams/HELP', people.dev.cookie)).statusCode).toBe(200);
    // Sub-issue linked once its parent arrived.
    expect((await issue('HELP-1')).parent?.identifier).toBe('HELP-3');

    // Old keys keep working in links and search.
    expect((await issue('ENG-2')).identifier).toBe('HELP-2');
    const found = await call('GET', '/api/search?q=ENG-3', owner);
    expect(found.json<{ issues: Array<{ identifier: string }> }>().issues[0]!.identifier).toBe(
      'HELP-3',
    );

    // Nobody was notified, and the token is gone.
    const inbox = await call('GET', '/api/me/notifications', people.dev.cookie);
    expect(inbox.json()).toEqual([]);
    const [row] = await t.ctx.db.select().from(importRuns).where(eq(importRuns.id, done.id));
    expect(row!.tokenEncrypted).toBeNull();
  });

  it('re-runs without duplicates: unchanged issues are skipped, changed ones updated', async () => {
    source.issues = [external(1), external(2)];
    await runImport();
    source.issues = [
      external(1),
      external(2, {
        title: 'Renamed',
        updatedAt: '2026-03-01T00:00:00.000Z',
        comments: [
          {
            externalId: 'new',
            author: null,
            body: 'Later',
            createdAt: '2026-03-01T00:00:00.000Z',
          },
        ],
      }),
      external(3),
    ];
    const second = await runImport();
    expect(second.counts).toMatchObject({ imported: 1, updated: 1, skipped: 1 });
    const renamed = await issue('HELP-2');
    expect(renamed.title).toBe('Renamed');
    expect(renamed.comments).toHaveLength(1);
    expect((await issue('HELP-3')).title).toBe('Issue 3');
    expect((await call('GET', '/api/issues/HELP-4', owner)).statusCode).toBe(404);
  });

  it('maps statuses by name first, then by category', async () => {
    const team = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
    const backlog = team.statuses.find((s) => s.category === 'backlog')!;
    source.issues = [
      external(1, { status: { name: 'Todo', category: 'unstarted' } }),
      external(2, { status: { name: 'Shipped', category: 'completed' } }),
    ];
    await runImport({ statusMap: { 'lin-team': { Todo: backlog.id } } });
    expect((await issue('HELP-1')).statusId).toBe(backlog.id);
    expect((await issue('HELP-2')).status.category).toBe('completed');
  });

  it('creates a new team when asked to', async () => {
    source.issues = [external(1)];
    const run = await connect();
    await call('PUT', `/api/admin/imports/${run.id}/config`, owner, {
      containers: [
        {
          externalId: 'lin-team',
          newTeam: { name: 'Engineering', key: 'ENG', departmentId: ids.it },
        },
      ],
    });
    await call('POST', `/api/admin/imports/${run.id}/start`, owner);
    await t.ctx.imports.runToCompletion(run.id);
    // The team took the source's key, so the old identifier is the new one.
    expect((await issue('ENG-1')).teamKey).toBe('ENG');
  });

  it('pauses, resumes and refuses invalid transitions', async () => {
    source.issues = [external(1), external(2), external(3)];
    const run = await connect();
    expect((await call('POST', `/api/admin/imports/${run.id}/start`, owner)).statusCode).toBe(409);
    await configure(run.id);
    await call('POST', `/api/admin/imports/${run.id}/start`, owner);
    expect((await call('POST', `/api/admin/imports/${run.id}/start`, owner)).statusCode).toBe(409);
    await t.ctx.imports.step(run.id);
    const paused = await call('POST', `/api/admin/imports/${run.id}/pause`, owner);
    expect(paused.json<ImportRunView>().status).toBe('paused');
    expect(await t.ctx.imports.step(run.id)).toBe(false);
    await call('POST', `/api/admin/imports/${run.id}/start`, owner);
    const done = await t.ctx.imports.runToCompletion(run.id);
    expect(done).toMatchObject({ status: 'completed', counts: { imported: 3 } });
    expect((await call('POST', `/api/admin/imports/${run.id}/cancel`, owner)).statusCode).toBe(409);
  });

  it('fails the run when the source starts refusing the token', async () => {
    source.issues = [external(1)];
    source.failWith = new SourceError('import_auth_failed', 'revoked');
    const done = await runImport();
    expect(done).toMatchObject({ status: 'failed', error: 'import_auth_failed' });
  });

  it('waits and retries when the source is rate limited', async () => {
    source.issues = [external(1)];
    source.failWith = new SourceError('import_source_failed', 'slow down', 60_000);
    const run = await connect();
    await configure(run.id);
    await call('POST', `/api/admin/imports/${run.id}/start`, owner);
    expect(await t.ctx.imports.step(run.id)).toBe(false);
    source.failWith = undefined;
    // Still inside the wait: nothing happens yet.
    expect(await t.ctx.imports.step(run.id)).toBe(false);
    expect((await t.ctx.imports.get(run.id)).status).toBe('running');
  });

  it('cancel erases the token and keeps what was imported', async () => {
    source.issues = [external(1), external(2), external(3)];
    const run = await connect();
    await configure(run.id);
    await call('POST', `/api/admin/imports/${run.id}/start`, owner);
    await t.ctx.imports.step(run.id);
    const canceled = await call('POST', `/api/admin/imports/${run.id}/cancel`, owner);
    expect(canceled.json<ImportRunView>().status).toBe('canceled');
    const [row] = await t.ctx.db.select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(row!.tokenEncrypted).toBeNull();
    expect((await issue('HELP-2')).title).toBe('Issue 2');
  });
});
