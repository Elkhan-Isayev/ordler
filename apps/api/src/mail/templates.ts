import type { Locale } from '@ordler/shared';
import { IntlMessageFormat } from 'intl-messageformat';

/** Email copy per locale (ICU MessageFormat); every locale must define every key. */
export const EMAIL_MESSAGES = {
  en: {
    otpSubject: '{code} is your {company} sign-in code',
    otpBody:
      'Your sign-in code for {company} is {code}.\n\nIt expires in {minutes, plural, one {# minute} other {# minutes}}. If you did not try to sign in, ignore this email.',
  },
  ru: {
    otpSubject: '{code} — ваш код входа в {company}',
    otpBody:
      'Ваш код для входа в {company}: {code}.\n\nКод действует {minutes, plural, one {# минуту} few {# минуты} many {# минут} other {# минуты}}. Если вы не пытались войти, просто проигнорируйте это письмо.',
  },
  de: {
    otpSubject: '{code} ist dein Anmeldecode für {company}',
    otpBody:
      'Dein Anmeldecode für {company} lautet {code}.\n\nEr ist {minutes, plural, one {# Minute} other {# Minuten}} gültig. Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail.',
  },
  az: {
    otpSubject: '{code} — {company} üçün giriş kodunuz',
    otpBody:
      '{company} üçün giriş kodunuz: {code}.\n\nKod {minutes, plural, one {# dəqiqə} other {# dəqiqə}} ərzində etibarlıdır. Əgər daxil olmağa cəhd etməmisinizsə, bu məktubu nəzərə almayın.',
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
