import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { SUPPORTED_LOCALES } from '@ordler/shared';
import { describe, expect, it } from 'vitest';
import { EMAIL_MESSAGES, renderInviteEmail, renderOtpEmail, renderTestEmail } from './templates.js';

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
  it('renders the code, company and expiry in the recipient language', () => {
    const email = renderOtpEmail({ locale: 'ru', code: '042917', company: 'Push30', minutes: 10 });
    expect(email.subject).toBe('042917 — ваш код входа в Push30');
    expect(email.text).toContain('Код действует 10 минут.');
  });

  it('renders English', () => {
    const email = renderOtpEmail({ locale: 'en', code: '000001', company: 'Ordler', minutes: 1 });
    expect(email.text).toContain('It expires in 1 minute.');
  });
});

describe('renderInviteEmail', () => {
  it('includes the link and expiry in the recipient language', () => {
    const email = renderInviteEmail({
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
