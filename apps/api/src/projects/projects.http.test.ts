import type {
  AdminRole,
  InviteResponse,
  IssueDetail,
  ProjectDetail,
  ProjectSummary,
  TeamView,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;
let roles: AdminRole[];
const ids = {} as Record<'it' | 'fin' | 'help' | 'ops' | 'acc', string>;
const people = {} as Record<'admin' | 'dev' | 'peer' | 'fin', { cookie: string; id: string }>;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function person(name: keyof typeof people, roleKey: string, scope: object, teams: string[]) {
  const invite = (
    await call('POST', '/api/admin/members', owner, {
      email: `${name}@push30.test`,
      name,
      role: { roleId: roles.find((r) => r.key === roleKey)!.id, scope },
      teamIds: teams,
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
  t = await createTestApp();
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  const dept = async (name: string) =>
    (await call('POST', '/api/admin/departments', owner, { name })).json<{ id: string }>().id;
  const team = async (d: string, name: string, key: string, isPrivate = false) =>
    (
      await call('POST', `/api/admin/departments/${d}/teams`, owner, { name, key, isPrivate })
    ).json<{ id: string }>().id;
  ids.it = await dept('IT');
  ids.fin = await dept('Finance');
  ids.help = await team(ids.it, 'Helpdesk', 'HELP');
  ids.ops = await team(ids.it, 'Operations', 'OPS');
  ids.acc = await team(ids.fin, 'Accounting', 'ACC', true);
  await person('admin', 'department_admin', { type: 'department', id: ids.it }, [ids.help]);
  await person('dev', 'member', { type: 'department', id: ids.it }, [ids.help]);
  await person('peer', 'member', { type: 'department', id: ids.it }, [ids.help]);
  await person('fin', 'member', { type: 'team', id: ids.acc }, [ids.acc]);
});
afterEach(() => t.close());

const project = (cookie: string, body: object) => call('POST', '/api/projects', cookie, body);

describe('projects (SPEC §5.2)', () => {
  it('are created by project managers of every chosen team and seen through those teams', async () => {
    const body = { name: 'Office move', teamIds: [ids.help, ids.ops], leadId: null, memberIds: [] };
    expect((await project(people.dev.cookie, body)).statusCode).toBe(403);
    // Department admins of IT cannot reach Finance's private team.
    expect(
      (await project(people.admin.cookie, { ...body, teamIds: [ids.help, ids.acc] })).statusCode,
    ).toBe(404);

    const created = await project(people.admin.cookie, {
      ...body,
      leadId: people.dev.id,
      memberIds: [people.dev.id],
      targetDate: '2026-12-01',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<ProjectDetail>()).toMatchObject({
      name: 'Office move',
      status: 'planned',
      lead: { name: 'dev' },
      teams: [{ key: 'HELP' }, { key: 'OPS' }],
      progress: { total: 0 },
    });
    const listed = (await call('GET', '/api/projects', people.peer.cookie)).json<
      ProjectSummary[]
    >();
    expect(listed.map((p) => p.name)).toEqual(['Office move']);
    expect((await call('GET', '/api/projects', people.fin.cookie)).json()).toEqual([]);
    expect(
      (await call('GET', `/api/projects/${created.json<ProjectDetail>().id}`, people.fin.cookie))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/api/teams/OPS/projects', people.dev.cookie)).json<ProjectSummary[]>(),
    ).toHaveLength(1);
  });

  it('tracks issues, milestones, progress and status updates', async () => {
    const p = (
      await project(people.admin.cookie, {
        name: 'Office move',
        teamIds: [ids.help],
        leadId: people.dev.id,
        memberIds: [people.dev.id],
      })
    ).json<ProjectDetail>();
    const withMilestone = (
      await call('POST', `/api/projects/${p.id}/milestones`, people.dev.cookie, {
        name: 'Pack',
        targetDate: null,
      })
    ).json<ProjectDetail>();
    const milestone = withMilestone.milestones[0]!;
    const team = (await call('GET', '/api/teams/HELP', people.dev.cookie)).json<TeamView>();
    expect(team.projects).toEqual([
      { id: p.id, name: 'Office move', milestones: [{ id: milestone.id, name: 'Pack' }] },
    ]);
    const done = team.statuses.find((s) => s.key === 'done')!.id;

    // A milestone alone puts the issue in its project.
    const a = (
      await call('POST', '/api/teams/HELP/issues', people.dev.cookie, {
        title: 'Boxes',
        milestoneId: milestone.id,
      })
    ).json<IssueDetail>();
    expect(a).toMatchObject({ projectId: p.id, milestoneId: milestone.id });
    await call('POST', '/api/teams/HELP/issues', people.dev.cookie, {
      title: 'Movers',
      projectId: p.id,
    });
    await call('PATCH', `/api/issues/${a.identifier}`, people.dev.cookie, { statusId: done });
    expect(
      (
        await call('POST', '/api/teams/OPS/issues', owner, { title: 'Elsewhere', projectId: p.id })
      ).json(),
    ).toEqual({ error: 'project_not_in_team' });

    // Moving to no project drops the milestone too, recorded in history.
    const moved = (
      await call('PATCH', '/api/issues/HELP-2', people.dev.cookie, { projectId: null })
    ).json<IssueDetail>();
    expect(moved).toMatchObject({ projectId: null, milestoneId: null });
    await call('PATCH', '/api/issues/HELP-2', people.dev.cookie, { projectId: p.id });

    const posted = await call('POST', `/api/projects/${p.id}/updates`, people.dev.cookie, {
      health: 'at_risk',
      body: 'Movers are late.',
    });
    expect(posted.json<ProjectDetail>()).toMatchObject({
      health: 'at_risk',
      progress: { total: 2, completed: 1 },
      milestones: [{ name: 'Pack', progress: { total: 1, completed: 1 } }],
      updates: [{ health: 'at_risk', author: { name: 'dev' }, body: 'Movers are late.' }],
    });
    expect(
      posted
        .json<ProjectDetail>()
        .issues.map((i) => i.identifier)
        .sort(),
    ).toEqual(['HELP-1', 'HELP-2']);
    // A teammate outside the project may read it but not post or edit.
    expect(
      (
        await call('POST', `/api/projects/${p.id}/updates`, people.peer.cookie, {
          health: 'on_track',
          body: 'x',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/api/projects/${p.id}`, people.peer.cookie, { status: 'paused' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('PATCH', `/api/projects/${p.id}`, people.dev.cookie, { status: 'in_progress' })
      ).json(),
    ).toMatchObject({ status: 'in_progress' });
  });

  it('archives without losing issues and lets teams leave', async () => {
    const p = (
      await project(people.admin.cookie, { name: 'Upgrade', teamIds: [ids.help, ids.ops] })
    ).json<ProjectDetail>();
    await call('POST', '/api/teams/HELP/issues', owner, { title: 'Help part', projectId: p.id });
    await call('POST', '/api/teams/OPS/issues', owner, { title: 'Ops part', projectId: p.id });
    await call('PATCH', `/api/projects/${p.id}`, people.admin.cookie, { teamIds: [ids.help] });
    expect(
      (await call('GET', '/api/issues/OPS-1', owner)).json<IssueDetail>().projectId,
    ).toBeNull();

    expect((await call('DELETE', `/api/projects/${p.id}`, people.admin.cookie)).statusCode).toBe(
      204,
    );
    expect((await call('GET', `/api/projects/${p.id}`, people.admin.cookie)).statusCode).toBe(404);
    const issue = (await call('GET', '/api/issues/HELP-1', owner)).json<IssueDetail>();
    expect(issue).toMatchObject({ title: 'Help part', projectId: null });
  });
});

describe('readable teams', () => {
  it('lists only teams the member can read', async () => {
    const keys = async (cookie: string) =>
      (await call('GET', '/api/teams', cookie)).json<Array<{ key: string }>>().map((t) => t.key);
    expect(await keys(people.dev.cookie)).toEqual(['HELP', 'OPS']);
    expect(await keys(people.fin.cookie)).toEqual(['ACC']);
  });
});

describe('initiatives (SPEC §5.2)', () => {
  it('group visible projects, roll up health and progress, and are managed by initiative managers', async () => {
    const a = (
      await project(people.admin.cookie, { name: 'Office move', teamIds: [ids.help] })
    ).json<ProjectDetail>();
    const b = (
      await project(people.admin.cookie, { name: 'New laptops', teamIds: [ids.ops] })
    ).json<ProjectDetail>();
    const hidden = (
      await project(owner, { name: 'Payroll', teamIds: [ids.acc] })
    ).json<ProjectDetail>();
    await call('POST', `/api/projects/${a.id}/updates`, people.admin.cookie, {
      health: 'on_track',
      body: 'ok',
    });
    await call('POST', `/api/projects/${b.id}/updates`, people.admin.cookie, {
      health: 'off_track',
      body: 'late',
    });
    const done = (await call('GET', '/api/teams/HELP', owner))
      .json<TeamView>()
      .statuses.find((s) => s.key === 'done')!.id;
    await call('POST', '/api/teams/HELP/issues', owner, {
      title: 'Boxes',
      projectId: a.id,
      statusId: done,
    });
    await call('POST', '/api/teams/OPS/issues', owner, { title: 'Order', projectId: b.id });

    // Only initiative managers (org admins and owners by default) create them.
    expect(
      (await call('POST', '/api/initiatives', people.admin.cookie, { name: 'Growth' })).statusCode,
    ).toBe(403);
    const created = (
      await call('POST', '/api/initiatives', owner, {
        name: 'Growth 2027',
        ownerId: people.admin.id,
      })
    ).json<{ id: string }>();
    await call('PUT', `/api/initiatives/${created.id}/projects`, owner, {
      projectIds: [a.id, b.id, hidden.id],
    });

    // The owner may edit; everyone reads, seeing only projects they can see.
    const asAdmin = (
      await call('GET', `/api/initiatives/${created.id}`, people.admin.cookie)
    ).json<{
      projects: Array<{ name: string }>;
      health: string;
      progress: { total: number; completed: number };
      can: { edit: boolean };
    }>();
    expect(asAdmin).toMatchObject({
      health: 'off_track',
      progress: { total: 2, completed: 1 },
      can: { edit: true },
    });
    expect(asAdmin.projects.map((p) => p.name)).toEqual(['New laptops', 'Office move']);
    const asFin = (await call('GET', `/api/initiatives/${created.id}`, people.fin.cookie)).json<{
      projects: Array<{ name: string }>;
      can: { edit: boolean };
    }>();
    expect(asFin.projects.map((p) => p.name)).toEqual(['Payroll']);
    expect(asFin.can.edit).toBe(false);
    expect(
      (
        await call('PATCH', `/api/initiatives/${created.id}`, people.fin.cookie, {
          status: 'active',
        })
      ).statusCode,
    ).toBe(403);

    // Editing projects keeps the ones the editor cannot see.
    await call('PUT', `/api/initiatives/${created.id}/projects`, people.admin.cookie, {
      projectIds: [a.id],
    });
    const after = (await call('GET', `/api/initiatives/${created.id}`, owner)).json<{
      projects: Array<{ name: string }>;
    }>();
    expect(after.projects.map((p) => p.name)).toEqual(['Office move', 'Payroll']);

    expect(
      (await call('GET', '/api/initiatives', people.dev.cookie)).json<unknown[]>(),
    ).toHaveLength(1);
    expect(
      (await call('DELETE', `/api/initiatives/${created.id}`, people.admin.cookie)).statusCode,
    ).toBe(204);
    expect((await call('GET', '/api/initiatives', owner)).json()).toEqual([]);
  });
});
