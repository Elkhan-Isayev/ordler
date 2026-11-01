import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { SUPPORTED_LOCALES } from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { completeSetup } from '../test/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../test/pglite.js';
import {
  EMAIL_MESSAGES,
  EMAIL_TEMPLATES,
  defaultTemplateText,
  listEmailTemplates,
  renderInviteEmail,
  renderNotificationEmail,
  renderOtpEmail,
  renderTestEmail,
  resetEmailTemplate,
  saveEmailTemplate,
  validateTemplateText,
} from './templates.js';

let test: TestDatabase;
let db: Db;
let ownerId: string;
const actor = () => ({ type: 'member' as const, id: ownerId });

beforeEach(async () => {
  test = await createTestDatabase();
  db = test.db;
  ownerId = await completeSetup(db);
});
afterEach(() => test.close());

const pluralOptions = (elements: MessageFormatElement[]) =>
  elements.flatMap((e) => (e.type === TYPE.plural ? [Object.keys(e.options)] : []));

describe.each(SUPPORTED_LOCALES)('email messages %s', (locale) => {
  it('defines every English key', () => {
    expect(Object.keys(EMAIL_MESSAGES[locale]).sort()).toEqual(
      Object.keys(EMAIL_MESSAGES.en).sort(),
    );
  });

  it('covers every plural category of the language', () => {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, message] of Object.entries(EMAIL_MESSAGES[locale])) {
      for (const options of pluralOptions(parse(message))) {
        for (const category of categories)
          expect(options, `${key}:${category}`).toContain(category);
      }
    }
  });
});

describe('renderOtpEmail', () => {
  it('renders the code, company and expiry in the recipient language', async () => {
    const email = await renderOtpEmail(db, {
      locale: 'ru',
      code: '042917',
      company: 'Push30',
      minutes: 10,
    });
    expect(email.subject).toBe('042917 — ваш код входа в Push30');
    expect(email.text).toContain('Код действует 10 минут.');
  });

  it('renders English', async () => {
    const email = await renderOtpEmail(db, {
      locale: 'en',
      code: '000001',
      company: 'Ordler',
      minutes: 1,
    });
    expect(email.text).toContain('It expires in 1 minute.');
  });
});

describe('renderInviteEmail', () => {
  it('includes the link and expiry in the recipient language', async () => {
    const email = await renderInviteEmail(db, {
      locale: 'ru',
      company: 'Push30',
      url: 'https://ordler.test/invite/abc',
      days: 7,
    });
    expect(email.subject).toBe('Приглашение в Push30 в Ordler');
    expect(email.text).toContain('https://ordler.test/invite/abc');
    expect(email.text).toContain('7 дней');
  });
});

describe('renderTestEmail', () => {
  it('names the company in the recipient language', () => {
    const email = renderTestEmail({ locale: 'de', company: 'Push30' });
    expect(email.subject).toBe('Test-E-Mail von Push30 in Ordler');
    expect(email.text).toContain('Mailserver-Einstellungen');
  });
});

describe('renderNotificationEmail', () => {
  const input = {
    company: 'Push30',
    kind: 'approval_requested',
    actor: 'Aysel',
    item: 'REQ-7',
    title: 'New laptop',
    url: 'https://ordler.test/requests/REQ-7',
  };

  it.each(SUPPORTED_LOCALES)('names the event and links to it in %s', async (locale) => {
    const mail = await renderNotificationEmail(db, { ...input, locale });
    expect(mail.subject).toMatch(/^\[Push30\] .*REQ-7/);
    expect(mail.text).toContain(input.url);
    expect(mail.text).toContain('New laptop');
  });

  it('falls back to the item for unknown kinds', async () => {
    expect(
      (await renderNotificationEmail(db, { ...input, locale: 'en', kind: 'something_else' }))
        .subject,
    ).toBe('[Push30] REQ-7');
  });

  it('wraps the event line in the admin wording', async () => {
    await saveEmailTemplate(
      db,
      'notification',
      'en',
      { subject: 'Ordler: {subject}', body: '{title}\n{url}' },
      actor(),
    );
    const mail = await renderNotificationEmail(db, { ...input, locale: 'en' });
    expect(mail).toEqual({
      subject: 'Ordler: Approval needed: REQ-7',
      text: 'New laptop\nhttps://ordler.test/requests/REQ-7',
    });
  });
});

describe('editable templates', () => {
  it.each(SUPPORTED_LOCALES)('built-in %s text passes its own validation', (locale) => {
    for (const key of Object.keys(EMAIL_TEMPLATES) as Array<keyof typeof EMAIL_TEMPLATES>) {
      expect(() => validateTemplateText(key, defaultTemplateText(key, locale))).not.toThrow();
    }
  });

  it('uses the custom text for its locale only and audits the change', async () => {
    await saveEmailTemplate(
      db,
      'otp',
      'ru',
      { subject: 'Код {code}', body: 'Ваш код: {code}. Компания {company}.' },
      actor(),
    );
    const ru = await renderOtpEmail(db, { locale: 'ru', code: '1', company: 'Push30', minutes: 5 });
    expect(ru).toEqual({ subject: 'Код 1', text: 'Ваш код: 1. Компания Push30.' });
    const en = await renderOtpEmail(db, { locale: 'en', code: '1', company: 'Push30', minutes: 5 });
    expect(en.subject).toBe('1 is your Push30 sign-in code');

    const list = await listEmailTemplates(db);
    const otp = list.find((t) => t.key === 'otp')!;
    expect(otp.locales.ru).toMatchObject({ customized: true, subject: 'Код {code}' });
    expect(otp.locales.en!.customized).toBe(false);
    expect(otp.required).toEqual(['code']);

    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'email_template.updated'));
    expect(row?.after).toMatchObject({ template: 'otp', locale: 'ru', subject: 'Код {code}' });
  });

  it('resets to the built-in text', async () => {
    await saveEmailTemplate(db, 'invite', 'en', { subject: 'Join', body: '{url}' }, actor());
    await resetEmailTemplate(db, 'invite', 'en', actor());
    const email = await renderInviteEmail(db, {
      locale: 'en',
      company: 'Push30',
      url: 'https://ordler.test/i',
      days: 7,
    });
    expect(email.subject).toBe('You are invited to Push30 on Ordler');
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, 'email_template.reset')),
    ).toHaveLength(1);
  });

  it('rejects broken syntax, unknown placeholders and a missing required one', async () => {
    await expect(
      saveEmailTemplate(db, 'otp', 'en', { subject: '{code', body: '{code}' }, actor()),
    ).rejects.toMatchObject({ code: 'template_invalid' });
    await expect(
      saveEmailTemplate(db, 'otp', 'en', { subject: '{code}', body: '{password}' }, actor()),
    ).rejects.toMatchObject({ code: 'template_unknown_variable' });
    await expect(
      saveEmailTemplate(db, 'otp', 'en', { subject: 'Hi', body: 'No code here' }, actor()),
    ).rejects.toMatchObject({ code: 'template_missing_variable' });
    // Placeholders inside plural branches count too.
    expect(() =>
      validateTemplateText('otp', {
        subject: 'Code',
        body: '{minutes, plural, one {{code} for # minute} other {{code} for # minutes}}',
      }),
    ).not.toThrow();
  });

  it('treats angle brackets as text', async () => {
    await saveEmailTemplate(db, 'otp', 'en', { subject: '<b>{code}</b>', body: '{code}' }, actor());
    const email = await renderOtpEmail(db, { locale: 'en', code: '7', company: 'X', minutes: 1 });
    expect(email.subject).toBe('<b>7</b>');
  });
});
