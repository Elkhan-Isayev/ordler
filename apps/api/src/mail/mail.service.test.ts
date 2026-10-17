import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SmtpConfig } from '../config/env.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Db } from '../db/client.js';
import { auditLog, mailSettings } from '../db/schema.js';
import { completeSetup, testBox, testClock } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import { formatFrom, MailService } from './mail.service.js';
import type { MailMessage } from './mailer.js';

let test: TestDatabase;
let db: Db;
let box: SecretBox;
let ownerId: string;
let sent: Array<{ config: SmtpConfig; message: MailMessage }>;
let failWith: string | undefined;
const actor = () => ({ type: 'member' as const, id: ownerId });

const SETTINGS = {
  host: 'smtp.push30.test',
  port: 587,
  security: 'starttls' as const,
  verifyTls: true,
  username: 'ordler',
  password: 'smtp-secret',
  fromName: 'Push30 Tasks',
  fromEmail: 'tasks@push30.test',
};

function service(env?: SmtpConfig, now?: () => Date) {
  return new MailService({
    db,
    box,
    env,
    ...(now ? { now } : {}),
    transport: (config) => ({
      send: async (message) => {
        if (failWith) throw new Error(failWith);
        sent.push({ config, message });
      },
    }),
  });
}

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  box = testBox();
  ownerId = await completeSetup(db);
  sent = [];
  failWith = undefined;
});
afterEach(() => test.close());

describe('MailService', () => {
  it('is not configured on a fresh installation', async () => {
    const mail = service();
    expect(await mail.isConfigured()).toBe(false);
    expect((await mail.view()).source).toBe('none');
    await expect(mail.send({ to: 'a@push30.test', subject: 's', text: 't' })).rejects.toMatchObject(
      { code: 'mail_not_configured' },
    );
  });

  it('stores admin settings with the password encrypted and never returns it', async () => {
    const mail = service();
    const view = await mail.update(SETTINGS, actor());
    expect(view).toMatchObject({ source: 'database', host: 'smtp.push30.test', passwordSet: true });
    expect(view).not.toHaveProperty('password');

    const [row] = await db.select().from(mailSettings);
    expect(row!.passwordEncrypted).not.toContain('smtp-secret');

    await mail.send({ to: 'ann@push30.test', subject: 'Hi', text: 'Body' });
    expect(sent[0]!.config).toMatchObject({
      host: 'smtp.push30.test',
      user: 'ordler',
      password: 'smtp-secret',
      from: '"Push30 Tasks" <tasks@push30.test>',
    });
  });

  it('keeps the stored password when it is omitted and clears it on null', async () => {
    const mail = service();
    await mail.update(SETTINGS, actor());
    const withoutPassword = { ...SETTINGS, password: undefined };
    expect((await mail.update({ ...withoutPassword, port: 2525 }, actor())).passwordSet).toBe(true);
    expect((await mail.update({ ...withoutPassword, password: null }, actor())).passwordSet).toBe(
      false,
    );
  });

  it('audits changes without the password', async () => {
    await service().update(SETTINGS, actor());
    const entry = (await db.select().from(auditLog)).find(
      (row) => row.action === 'mail_settings.updated',
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain('smtp-secret');
  });

  it('prefers SMTP_* variables and refuses edits while they are set', async () => {
    const env: SmtpConfig = {
      host: 'smtp.env.test',
      port: 465,
      security: 'tls',
      verifyTls: true,
      user: 'env-user',
      password: 'env-pass',
      from: 'Ordler <no-reply@env.test>',
    };
    const mail = service(env);
    expect(await mail.view()).toMatchObject({
      source: 'env',
      host: 'smtp.env.test',
      passwordSet: true,
      fromEmail: 'Ordler <no-reply@env.test>',
    });
    await expect(mail.update(SETTINGS, actor())).rejects.toMatchObject({
      code: 'mail_managed_by_env',
    });
  });

  it('sees changes made by another replica after the cache window', async () => {
    const clock = testClock();
    const replica = service(undefined, clock.now);
    expect(await replica.isConfigured()).toBe(false);
    await service().update(SETTINGS, actor());
    expect(await replica.isConfigured()).toBe(false);
    clock.advance(16_000);
    expect(await replica.isConfigured()).toBe(true);
  });

  it('reports test email success and the SMTP error on failure', async () => {
    const mail = service();
    await mail.update(SETTINGS, actor());
    expect(await mail.sendTest('admin@push30.test', 'ru', 'Push30')).toEqual({ sent: true });
    expect(sent[0]!.message.subject).toBe('Тестовое письмо от Push30 в Ordler');

    failWith = '535 Authentication failed';
    expect(await mail.sendTest('admin@push30.test', 'en', 'Push30')).toEqual({
      sent: false,
      error: '535 Authentication failed',
    });
  });
});

describe('formatFrom', () => {
  it('quotes the display name', () => {
    expect(formatFrom('Ann "IT" Desk', 'it@push30.test')).toBe(
      '"Ann \\"IT\\" Desk" <it@push30.test>',
    );
    expect(formatFrom(null, 'it@push30.test')).toBe('it@push30.test');
  });
});
