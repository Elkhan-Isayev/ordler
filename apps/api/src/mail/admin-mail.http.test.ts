import type { InviteResponse, MailSettingsView } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';

let t: TestApp;
let owner: string;

const SETTINGS = {
  host: 'smtp.push30.test',
  port: 587,
  security: 'starttls',
  verifyTls: true,
  username: 'ordler',
  password: 'smtp-secret',
  fromName: 'Push30',
  fromEmail: 'tasks@push30.test',
};

function call(
  method: 'GET' | 'PUT' | 'PATCH' | 'POST',
  url: string,
  cookie?: string,
  payload?: object,
) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

/** A signed-in member with no admin permissions. */
async function plainMember(): Promise<string> {
  const invite = (
    await call('POST', '/api/admin/members', owner, { email: 'ann@push30.test', name: 'Ann' })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: invite.inviteUrl.split('/invite/')[1]!,
    name: 'Ann',
    password: 'ann-password-123',
  });
  return cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE);
}

beforeEach(async () => {
  // No SMTP_* variables: mail is configured through the admin panel.
  t = await createTestApp({ smtp: undefined });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
});
afterEach(() => t.close());

describe('Admin → Mail server', () => {
  it('lets an admin save settings without ever returning the password', async () => {
    expect((await call('GET', '/api/admin/mail', owner)).json<MailSettingsView>().source).toBe(
      'none',
    );
    const saved = await call('PUT', '/api/admin/mail', owner, SETTINGS);
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('smtp-secret');

    const view = (await call('GET', '/api/admin/mail', owner)).json<MailSettingsView>();
    expect(view).toMatchObject({ source: 'database', host: 'smtp.push30.test', passwordSet: true });
    expect(JSON.stringify(view)).not.toContain('smtp-secret');
  });

  it('makes email OTP available once mail is configured', async () => {
    const enable = () =>
      call('PATCH', '/api/admin/auth/strategies/email_otp', owner, { enabled: true });
    expect((await enable()).json()).toEqual({ error: 'mail_not_configured' });
    await call('PUT', '/api/admin/mail', owner, SETTINGS);
    expect((await enable()).statusCode).toBe(200);
  });

  it('sends a test email', async () => {
    await call('PUT', '/api/admin/mail', owner, SETTINGS);
    const result = await call('POST', '/api/admin/mail/test', owner, { to: 'owner@push30.test' });
    expect(result.json()).toEqual({ sent: true });
    expect(t.mailer.sent.at(-1)).toMatchObject({ to: 'owner@push30.test' });
  });

  it('rejects invalid settings', async () => {
    const result = await call('PUT', '/api/admin/mail', owner, { ...SETTINGS, port: 0 });
    expect(result.statusCode).toBe(400);
  });

  it('denies members without mail.manage', async () => {
    const ann = await plainMember();
    expect((await call('GET', '/api/admin/mail', ann)).statusCode).toBe(403);
    expect((await call('PUT', '/api/admin/mail', ann, SETTINGS)).statusCode).toBe(403);
    expect(
      (await call('POST', '/api/admin/mail/test', ann, { to: 'a@push30.test' })).statusCode,
    ).toBe(403);
  });

  it('requires a session', async () => {
    expect((await call('GET', '/api/admin/mail')).statusCode).toBe(401);
  });
});
