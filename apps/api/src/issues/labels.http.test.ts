import type { AdminRole, InviteResponse, IssueDetail, LabelView, TeamView } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let help: TeamView;
let accId: string;
let dev: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

const label = (cookie: string, body: object) => call('POST', '/api/labels', cookie, body);
const issue = async (cookie: string, body: object, key = 'HELP') =>
  call('POST', `/api/teams/${key}/issues`, cookie, body);

beforeEach(async () => {
  t = await createTestApp();
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const it = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>();
  await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
    name: 'Helpdesk',
    key: 'HELP',
  });
  accId = (
    await call('POST', `/api/admin/departments/${it.id}/teams`, owner, {
      name: 'Accounting',
      key: 'ACC',
    })
  ).json<{ id: string }>().id;
  help = (await call('GET', '/api/teams/HELP', owner)).json<TeamView>();
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: 'dev@push30.test',
      name: 'dev',
      role: {
        roleId: roles.find((r) => r.key === 'member')!.id,
        scope: { type: 'team', id: help.id },
      },
      teamIds: [help.id],
    })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: invite.inviteUrl.split('/invite/')[1]!,
    name: 'dev',
    password: 'person-password-1',
  });
  dev = cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE);
});
afterEach(() => t.close());

describe('labels', () => {
  it('team members create team labels; only admins create organization labels', async () => {
    const bug = await label(dev, { teamId: help.id, name: 'Bug', color: '#E5484D' });
    expect(bug.statusCode).toBe(201);
    expect(bug.json()).toMatchObject({ name: 'Bug', color: '#e5484d', scope: 'team' });
    expect((await label(dev, { teamId: help.id, name: 'bug', color: '#000000' })).json()).toEqual({
      error: 'label_name_taken',
    });
    expect(
      (await label(dev, { teamId: null, name: 'Security', color: '#000000' })).statusCode,
    ).toBe(403);
    expect(
      (await label(owner, { teamId: null, name: 'Security', color: '#111111' })).statusCode,
    ).toBe(201);
    // Teams the member cannot read answer not_found.
    expect((await label(dev, { teamId: accId, name: 'Tax', color: '#111111' })).statusCode).toBe(
      404,
    );
    expect((await label(dev, { teamId: help.id, name: 'Bad', color: 'red' })).statusCode).toBe(400);

    const team = (await call('GET', '/api/teams/HELP', dev)).json<TeamView>();
    expect(team.labels.map((l) => [l.name, l.scope])).toEqual([
      ['Bug', 'team'],
      ['Security', 'organization'],
    ]);
  });

  it('tags issues, records the change and removes deleted labels', async () => {
    const bug = (
      await label(dev, { teamId: help.id, name: 'Bug', color: '#e5484d' })
    ).json<LabelView>();
    const ui = (
      await label(dev, { teamId: help.id, name: 'UI', color: '#3e63dd' })
    ).json<LabelView>();
    const tax = (
      await label(owner, { teamId: accId, name: 'Tax', color: '#111111' })
    ).json<LabelView>();

    const created = (
      await issue(dev, { title: 'Button broken', labelIds: [ui.id, bug.id, bug.id] })
    ).json<IssueDetail>();
    expect(created.labels.map((l) => l.name)).toEqual(['Bug', 'UI']);
    expect((await issue(dev, { title: 'x', labelIds: [tax.id] })).json()).toEqual({
      error: 'label_not_in_team',
    });

    const updated = (
      await call('PATCH', '/api/issues/HELP-1', dev, { labelIds: [bug.id] })
    ).json<IssueDetail>();
    expect(updated.labels.map((l) => l.name)).toEqual(['Bug']);
    expect(updated.events.at(-1)!.changes).toEqual({
      labelIds: { from: [bug.id, ui.id].sort(), to: [bug.id] },
    });
    // Same set again: no history entry.
    await call('PATCH', '/api/issues/HELP-1', dev, { labelIds: [bug.id] });
    expect((await call('GET', '/api/issues/HELP-1', dev)).json<IssueDetail>().events).toHaveLength(
      2,
    );

    // Renaming and deleting are team settings: the member may not.
    expect(
      (await call('PATCH', `/api/labels/${bug.id}`, dev, { name: 'Defect', color: '#e5484d' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('PATCH', `/api/labels/${bug.id}`, owner, { name: 'Defect', color: '#e5484d' })
      ).json(),
    ).toMatchObject({
      name: 'Defect',
    });
    expect((await call('DELETE', `/api/labels/${bug.id}`, owner)).statusCode).toBe(204);
    expect((await call('GET', '/api/issues/HELP-1', dev)).json<IssueDetail>().labels).toEqual([]);
  });
});

describe('sub-issues', () => {
  it('nests issues inside the same team and refuses loops', async () => {
    const parent = (await issue(dev, { title: 'Office move' })).json<IssueDetail>();
    const child = (
      await issue(dev, { title: 'Pack monitors', parentId: parent.id })
    ).json<IssueDetail>();
    const grandchild = (
      await issue(dev, { title: 'Buy boxes', parentId: child.id })
    ).json<IssueDetail>();
    expect(child.parent).toEqual({ id: parent.id, identifier: 'HELP-1', title: 'Office move' });

    const detail = (await call('GET', '/api/issues/HELP-1', dev)).json<IssueDetail>();
    expect(detail.children.map((c) => c.identifier)).toEqual(['HELP-2']);
    expect(detail.grandchildren.map((c) => [c.identifier, c.parentId])).toEqual([
      ['HELP-3', child.id],
    ]);
    expect(detail.ancestors).toEqual([]);
    const deep = (await call('GET', '/api/issues/HELP-3', dev)).json<IssueDetail>();
    expect(deep.ancestors.map((a) => a.identifier)).toEqual(['HELP-1', 'HELP-2']);
    expect(detail.parent).toBeNull();

    expect(
      (await call('PATCH', '/api/issues/HELP-1', dev, { parentId: grandchild.id })).json(),
    ).toEqual({
      error: 'invalid_parent',
    });
    expect(
      (await call('PATCH', '/api/issues/HELP-1', dev, { parentId: parent.id })).json(),
    ).toEqual({
      error: 'invalid_parent',
    });
    const other = (await issue(owner, { title: 'Ledger' }, 'ACC')).json<IssueDetail>();
    expect((await issue(owner, { title: 'Cross', parentId: other.id })).json()).toEqual({
      error: 'invalid_parent',
    });

    // Detach: back to a top-level issue, recorded in history.
    const detached = (
      await call('PATCH', '/api/issues/HELP-3', dev, { parentId: null })
    ).json<IssueDetail>();
    expect(detached.parent).toBeNull();
    expect(detached.events.at(-1)!.changes).toEqual({ parentId: { from: child.id, to: null } });
  });
});

describe('search (SPEC §5.4)', () => {
  it('finds issues by title, description, comment and identifier in readable teams only', async () => {
    await issue(dev, { title: 'VPN drops at night', description: 'Tunnel resets' });
    await issue(dev, { title: 'Printer' });
    await call('POST', '/api/issues/HELP-2/comments', dev, { body: 'Toner 100% empty_' });
    await issue(owner, { title: 'VPN budget' }, 'ACC');

    const find = async (cookie: string, q: string) =>
      (await call('GET', `/api/search?q=${encodeURIComponent(q)}`, cookie)).json<{
        issues: Array<{ identifier: string }>;
        requests: unknown[];
      }>();
    expect((await find(dev, 'vpn')).issues.map((i) => i.identifier)).toEqual(['HELP-1']);
    expect((await find(owner, 'vpn')).issues.map((i) => i.identifier).sort()).toEqual([
      'ACC-1',
      'HELP-1',
    ]);
    expect((await find(dev, 'tunnel')).issues.map((i) => i.identifier)).toEqual(['HELP-1']);
    expect((await find(dev, '100% empty_')).issues.map((i) => i.identifier)).toEqual(['HELP-2']);
    // % is literal, not a wildcard.
    expect((await find(dev, '%')).issues.map((i) => i.identifier)).toEqual(['HELP-2']);
    expect((await find(dev, 'help-2')).issues.map((i) => i.identifier)).toEqual(['HELP-2']);
    expect((await call('GET', '/api/search?q=', dev)).statusCode).toBe(400);
  });
});
