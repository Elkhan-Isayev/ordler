import type { DatabaseSettingsInput, DatabaseSettingsView, InviteResponse } from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContextDeps } from '../app-context.js';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../db/schema.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
afterEach(() => t.close());

const SETTINGS = {
  host: 'new-db.push30.test',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  ssl: 'require',
  schema: 'ordler',
};

const CURRENT = {
  host: 'db.push30.test',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  password: 'db-secret',
  schema: 'ordler',
  ssl: 'disable' as const,
  poolMax: 20,
};

async function start(databaseSettings?: Partial<AppContextDeps['databaseSettings']>) {
  t = await createTestApp(
    databaseSettings
      ? {
          databaseSettings: {
            source: 'file',
            current: CURRENT,
            probe: async () => ({ ok: true, serverVersion: '18.1' }),
            save: () => undefined,
            ...databaseSettings,
          },
        }
      : {},
  );
  const setup = await t.app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  return cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
}

const call = (method: 'GET' | 'PUT', cookie: string, payload?: object) =>
  t.app.inject({
    method,
    url: '/api/admin/database',
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });

/** Signs in a second member holding the Organization Admin role. */
async function orgAdmin(owner: string): Promise<string> {
  const roles = (await t.app.inject({ url: '/api/admin/roles', headers: { cookie: owner } })).json<
    Array<{ id: string; key: string }>
  >();
  const invite = (
    await t.app.inject({
      method: 'POST',
      url: '/api/admin/members',
      headers: { cookie: owner },
      payload: {
        email: 'admin@push30.test',
        name: 'Admin',
        role: {
          roleId: roles.find((r) => r.key === 'org_admin')!.id,
          scope: { type: 'organization' },
        },
      },
    })
  ).json<InviteResponse>();
  const accepted = await t.app.inject({
    method: 'POST',
    url: '/api/invites/accept',
    payload: {
      token: invite.inviteUrl.split('/invite/')[1]!,
      name: 'Admin',
      password: 'admin-password-1',
    },
  });
  return cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE);
}

describe('Admin → Database', () => {
  it('shows the running connection without the password', async () => {
    const owner = await start();
    const view = await call('GET', owner);
    expect(view.json<DatabaseSettingsView>()).toMatchObject({
      source: 'env',
      host: 'db.ordler.test',
      database: 'ordler',
      passwordSet: true,
    });
    expect(view.body).not.toContain('db-secret');
  });

  it('refuses changes while the connection comes from environment variables', async () => {
    const owner = await start();
    expect((await call('PUT', owner, SETTINGS)).json()).toEqual({
      error: 'database_managed_by_env',
    });
  });

  it('lets the Owner change installer settings, keeping the password when omitted', async () => {
    const saved: DatabaseSettingsInput[] = [];
    const owner = await start({ save: (input) => saved.push(input) });
    const result = await call('PUT', owner, SETTINGS);
    expect(result.json()).toEqual({ saved: true, restartRequired: true });
    expect(saved[0]).toMatchObject({ host: 'new-db.push30.test', password: 'db-secret' });

    const audit = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'database_settings.updated'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('db-secret');
  });

  it('does not save settings that cannot connect', async () => {
    const saved: DatabaseSettingsInput[] = [];
    const owner = await start({
      probe: async () => ({ ok: false, error: 'authentication_failed', detail: 'bad password' }),
      save: (input) => saved.push(input),
    });
    expect((await call('PUT', owner, { ...SETTINGS, password: 'wrong' })).json()).toEqual({
      saved: false,
      error: 'authentication_failed',
      detail: 'bad password',
    });
    expect(saved).toHaveLength(0);
  });

  it('lets org admins view but not change the database', async () => {
    const owner = await start({});
    const admin = await orgAdmin(owner);
    expect((await call('GET', admin)).statusCode).toBe(200);
    expect((await call('PUT', admin, SETTINGS)).statusCode).toBe(403);
  });

  it('requires a session', async () => {
    await start();
    expect((await t.app.inject({ url: '/api/admin/database' })).statusCode).toBe(401);
  });
});
