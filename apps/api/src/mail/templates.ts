import type { Locale } from '@ordler/shared';
import { IntlMessageFormat } from 'intl-messageformat';

/** Email copy per locale (ICU MessageFormat); every locale must define every key. */
export const EMAIL_MESSAGES = {
  en: {
    otpSubject: '{code} is your {company} sign-in code',
    otpBody:
      'Your sign-in code for {company} is {code}.\n\nIt expires in {minutes, plural, one {# minute} other {# minutes}}. If you did not try to sign in, ignore this email.',
    inviteSubject: 'You are invited to {company} on Ordler',
    inviteBody:
      'You have been invited to join {company} on Ordler.\n\nOpen this link to set your name and password:\n{url}\n\nThe link works once and expires in {days, plural, one {# day} other {# days}}.',
  },
  ru: {
    otpSubject: '{code} — ваш код входа в {company}',
    otpBody:
      'Ваш код для входа в {company}: {code}.\n\nКод действует {minutes, plural, one {# минуту} few {# минуты} many {# минут} other {# минуты}}. Если вы не пытались войти, просто проигнорируйте это письмо.',
    inviteSubject: 'Приглашение в {company} в Ordler',
    inviteBody:
      'Вас пригласили в {company} в Ordler.\n\nОткройте ссылку, чтобы указать имя и пароль:\n{url}\n\nСсылка одноразовая и действует {days, plural, one {# день} few {# дня} many {# дней} other {# дня}}.',
  },
  de: {
    otpSubject: '{code} ist dein Anmeldecode für {company}',
    otpBody:
      'Dein Anmeldecode für {company} lautet {code}.\n\nEr ist {minutes, plural, one {# Minute} other {# Minuten}} gültig. Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail.',
    inviteSubject: 'Einladung zu {company} in Ordler',
    inviteBody:
      'Du wurdest zu {company} in Ordler eingeladen.\n\nÖffne diesen Link, um deinen Namen und dein Passwort festzulegen:\n{url}\n\nDer Link funktioniert einmal und ist {days, plural, one {# Tag} other {# Tage}} gültig.',
  },
  az: {
    otpSubject: '{code} — {company} üçün giriş kodunuz',
    otpBody:
      '{company} üçün giriş kodunuz: {code}.\n\nKod {minutes, plural, one {# dəqiqə} other {# dəqiqə}} ərzində etibarlıdır. Əgər daxil olmağa cəhd etməmisinizsə, bu məktubu nəzərə almayın.',
    inviteSubject: 'Ordler-də {company} komandasına dəvət',
    inviteBody:
      'Sizi Ordler-də {company} komandasına dəvət etdilər.\n\nAdınızı və şifrənizi təyin etmək üçün bu linki açın:\n{url}\n\nLink birdəfəlikdir və {days, plural, one {# gün} other {# gün}} ərzində etibarlıdır.',
  },
} satisfies Record<Locale, Record<string, string>>;

export type EmailMessageKey = keyof (typeof EMAIL_MESSAGES)['en'];

export function formatEmailMessage(
  locale: Locale,
  key: EmailMessageKey,
  values: Record<string, string | number>,
): string {
  return new IntlMessageFormat(EMAIL_MESSAGES[locale][key], locale).format(values) as string;
}

export function renderOtpEmail(input: {
  locale: Locale;
  code: string;
  company: string;
  minutes: number;
}): { subject: string; text: string } {
  const values = { code: input.code, company: input.company, minutes: input.minutes };
  return {
    subject: formatEmailMessage(input.locale, 'otpSubject', values),
    text: formatEmailMessage(input.locale, 'otpBody', values),
  };
}

export function renderInviteEmail(input: {
  locale: Locale;
  company: string;
  url: string;
  days: number;
}): { subject: string; text: string } {
  const values = { company: input.company, url: input.url, days: input.days };
  return {
    subject: formatEmailMessage(input.locale, 'inviteSubject', values),
    text: formatEmailMessage(input.locale, 'inviteBody', values),
  };
}
