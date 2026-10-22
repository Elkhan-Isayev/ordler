import type {
  AdminRole,
  InviteResponse,
  IssueDetail,
  IssueSummary,
  TeamView,
} from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { RecordingNotifier } from '../notifications/notifier.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let notifier: RecordingNotifier;
let owner: string;
let team: TeamView;
const people: Record<'ann' | 'bob' | 'cat', { cookie: string; id: string }> = {} as never;

type Method = 'GET' | 'POST' | 'PATCH';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

beforeEach(async () => {
  notifier = new RecordingNotifier();
  t = await createTestApp({ notifier });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const dept = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>();
  await call('POST', `/api/admin/departments/${dept.id}/teams`, owner, {
    name: 'Platform',
    key: 'PLAT',
  });
  team = (await call('GET', '/api/teams/PLAT', owner)).json<TeamView>();
  const roles = (await call('GET', '/api/admin/roles', owner)).json<AdminRole[]>();
  for (const name of ['ann', 'bob', 'cat'] as const) {
    const invite = (
      await call('POST', '/api/admin/members', owner, {
        email: `${name}@push30.test`,
        name,
        role: {
          roleId: roles.find((r) => r.key === 'member')!.id,
          scope: { type: 'team', id: team.id },
        },
        teamIds: [team.id],
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

describe('assignees', () => {
  it('allows one assignee by default', async () => {
    expect(team.settings).toEqual({ multipleAssignees: false });
    const two = await call('POST', '/api/teams/PLAT/issues', owner, {
      title: 'Pair task',
      assigneeIds: [people.ann.id, people.bob.id],
    });
    expect(two.json()).toEqual({ error: 'single_assignee' });

    const one = (
      await call('POST', '/api/teams/PLAT/issues', owner, {
        title: 'Solo',
        assigneeId: people.ann.id,
      })
    ).json<IssueDetail>();
    expect(one.assignees.map((a) => a.name)).toEqual(['ann']);
    expect(one.assignee).toMatchObject({ name: 'ann' });
    const moved = (
      await call('PATCH', '/api/issues/PLAT-1', owner, { assigneeIds: [people.bob.id] })
    ).json<IssueDetail>();
    expect(moved.events.at(-1)!.changes).toEqual({
      assigneeId: { from: people.ann.id, to: people.bob.id },
    });
  });

  it('lets a team enabled for it assign several people', async () => {
    // Only team managers change the setting.
    expect(
      (
        await call('PATCH', `/api/admin/teams/${team.id}`, people.ann.cookie, {
          multipleAssignees: true,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/api/admin/teams/${team.id}`, owner, { multipleAssignees: true }))
        .statusCode,
    ).toBeLessThan(300);
    expect(
      (await call('GET', '/api/teams/PLAT', owner)).json<TeamView>().settings.multipleAssignees,
    ).toBe(true);

    const created = (
      await call('POST', '/api/teams/PLAT/issues', owner, {
        title: 'Release',
        assigneeIds: [people.ann.id, people.bob.id, people.ann.id],
      })
    ).json<IssueDetail>();
    expect(created.assignees.map((a) => a.name)).toEqual(['ann', 'bob']);
    expect(created.assignee).toMatchObject({ name: 'ann' });
    expect(notifier.sent.at(-1)).toMatchObject({
      kind: 'issue_assigned',
      recipients: [people.ann.id, people.bob.id],
    });

    const updated = (
      await call('PATCH', '/api/issues/PLAT-1', owner, {
        assigneeIds: [people.bob.id, people.cat.id],
      })
    ).json<IssueDetail>();
    expect(updated.assignees.map((a) => a.name)).toEqual(['bob', 'cat']);
    expect(updated.events.at(-1)!.changes).toEqual({
      assigneeIds: { from: [people.ann.id, people.bob.id], to: [people.bob.id, people.cat.id] },
    });
    // Only the newly added person hears about it.
    expect(notifier.sent.at(-1)).toMatchObject({
      kind: 'issue_assigned',
      recipients: [people.cat.id],
    });

    // Everyone assigned sees it under My issues.
    for (const name of ['bob', 'cat'] as const) {
      const mine = (await call('GET', '/api/me/issues', people[name].cookie)).json<
        IssueSummary[]
      >();
      expect(mine.map((i) => i.identifier)).toEqual(['PLAT-1']);
    }
    expect((await call('GET', '/api/me/issues', people.ann.cookie)).json()).toEqual([]);

    const outsider = await call('PATCH', '/api/issues/PLAT-1', owner, {
      assigneeIds: ['00000000-0000-7000-8000-000000000000'],
    });
    expect(outsider.json()).toEqual({ error: 'assignee_not_in_team' });
  });
});

describe('mentions', () => {
  const mention = (person: { id: string }, name: string) => `[@${name}](/people/${person.id})`;

  it('notifies people newly mentioned in descriptions and comments', async () => {
    await call('POST', '/api/teams/PLAT/issues', people.ann.cookie, {
      title: 'Test env',
      description: `Prepare it ${mention(people.bob, 'bob')}`,
    });
    expect(notifier.sent.at(-1)).toMatchObject({
      kind: 'issue_mentioned',
      recipients: [people.bob.id],
      actorId: people.ann.id,
    });

    // Editing keeps bob; only cat is new.
    notifier.sent.length = 0;
    await call('PATCH', '/api/issues/PLAT-1', people.ann.cookie, {
      description: `Prepare it ${mention(people.bob, 'bob')} ${mention(people.cat, 'cat')}`,
    });
    expect(notifier.sent).toMatchObject([{ kind: 'issue_mentioned', recipients: [people.cat.id] }]);

    // A comment mention replaces the generic comment notification for that person.
    notifier.sent.length = 0;
    await call('POST', '/api/issues/PLAT-1/comments', people.bob.cookie, {
      body: `Done, ${mention(people.ann, 'ann')}`,
    });
    expect(notifier.sent[0]).toMatchObject({
      kind: 'issue_mentioned',
      recipients: [people.ann.id],
    });
    // The actor is dropped later by the notification service; ann is not told twice.
    const commented = notifier.sent.filter((n) => n.kind === 'issue_commented');
    expect(commented.flatMap((n) => n.recipients)).not.toContain(people.ann.id);
  });

  it('never tells someone who cannot read the team', async () => {
    const dept = (await call('POST', '/api/admin/departments', owner, { name: 'Finance' })).json<{
      id: string;
    }>();
    await call('POST', `/api/admin/departments/${dept.id}/teams`, owner, {
      name: 'Ledger',
      key: 'LED',
      isPrivate: true,
    });
    notifier.sent.length = 0;
    await call('POST', '/api/teams/LED/issues', owner, {
      title: 'Secret',
      description: `ping ${mention(people.ann, 'ann')}`,
    });
    expect(notifier.sent.filter((n) => n.kind === 'issue_mentioned')).toEqual([]);
  });
});
