import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { members, roleAssignments } from '../db/schema.js';
import { systemRoleId } from '../setup/system-roles.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import type { FetchFn } from './github.js';

let t: TestApp;
afterEach(() => t.close());

let githubCalls = 0;
const github: FetchFn = async () => {
  githubCalls += 1;
  return Response.json([
    {
      tag_name: 'v1.5.0',
      name: 'Ordler 1.5.0',
      html_url: 'https://github.com/Elkhan-Isayev/ordler/releases/tag/v1.5.0',
      body: '- Faster boards',
      draft: false,
      prerelease: false,
      published_at: '2026-10-12T08:00:00Z',
    },
  ]);
};

async function start(version = '1.4.0') {
  githubCalls = 0;
  t = await createTestApp({
    version,
    updateCheck: { enabled: true, repository: 'Elkhan-Isayev/ordler' },
    updatesFetch: github,
  });
  const setup = await t.app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  return { setup, cookie: cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE) };
}

describe('admin update notification', () => {
  it('tells admins a newer version exists', async () => {
    const { cookie } = await start();
    const checked = await t.app.inject({
      method: 'POST',
      url: '/api/admin/updates/check',
      headers: { cookie },
    });
    expect(checked.statusCode).toBe(200);
    const status = await t.app.inject({
      method: 'GET',
      url: '/api/admin/updates',
      headers: { cookie },
    });
    expect(status.json()).toMatchObject({
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      updateAvailable: true,
      release: { name: 'Ordler 1.5.0', notes: '- Faster boards' },
    });
  });

  it('limits manual checks to one a minute', async () => {
    const { cookie } = await start();
    await t.app.inject({ method: 'POST', url: '/api/admin/updates/check', headers: { cookie } });
    const second = await t.app.inject({
      method: 'POST',
      url: '/api/admin/updates/check',
      headers: { cookie },
    });
    expect(second.statusCode).toBe(429);
    expect(githubCalls).toBe(1);
  });

  it('is hidden from members without org.manage', async () => {
    await start();
    const [member] = await t.database.db
      .insert(members)
      .values({ email: 'm@push30.test', name: 'M', status: 'active' })
      .returning({ id: members.id });
    await t.database.db.insert(roleAssignments).values({
      memberId: member!.id,
      roleId: (await systemRoleId(t.database.db, 'member'))!,
      scopeType: 'organization',
      scopeId: null,
    });
    const { token } = await t.ctx.sessions.create(member!.id, 'local');
    const cookie = `${SESSION_COOKIE}=${token}`;
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/admin/updates', headers: { cookie } }))
        .statusCode,
    ).toBe(403);
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().organizationPermissions).not.toContain('org.manage');
  });

  it('exposes organization permissions so the UI knows who is an admin', async () => {
    const { setup } = await start();
    expect(setup.json().organizationPermissions).toContain('org.manage');
  });
});
