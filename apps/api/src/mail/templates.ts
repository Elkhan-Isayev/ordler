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
    testSubject: 'Test email from {company} on Ordler',
    testBody:
      'This is a test email from {company} on Ordler.\n\nIf you can read it, the mail server settings work.',
    notifySubject:
      '{kind, select, issue_assigned {{actor} assigned you {item}} issue_commented {{actor} commented on {item}} issue_mentioned {{actor} mentioned you in {item}} issue_status_changed {{actor} changed the status of {item}} approval_requested {Approval needed: {item}} approval_decided {{actor} approved {item}} request_rejected {{item} was rejected} request_changes_requested {Changes requested on {item}} request_received {New request for your team: {item}} request_status_changed {{item} was updated} request_commented {{actor} commented on {item}} sla_at_risk {SLA at risk: {item}} sla_breached {SLA breached: {item}} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nOpen in Ordler: {url}\n\nDecisions and replies happen in Ordler after signing in.',
    slackOpen: 'Open in Ordler',
    slackEvent:
      '{kind, select, issue_created {New issue} issue_status_changed {Status changed} issue_assigned {Assigned} issue_commented {New comment} request_received {New request} approval_requested {Approval requested} approval_decided {Approval decided} request_resolved {Request resolved} sla_at_risk {SLA at risk} sla_breached {SLA breached} other {Update}}',
    slackTest: 'Ordler is connected to this channel for {team}.',
  },
  ru: {
    otpSubject: '{code} — ваш код входа в {company}',
    otpBody:
      'Ваш код для входа в {company}: {code}.\n\nКод действует {minutes, plural, one {# минуту} few {# минуты} many {# минут} other {# минуты}}. Если вы не пытались войти, просто проигнорируйте это письмо.',
    inviteSubject: 'Приглашение в {company} в Ordler',
    inviteBody:
      'Вас пригласили в {company} в Ordler.\n\nОткройте ссылку, чтобы указать имя и пароль:\n{url}\n\nСсылка одноразовая и действует {days, plural, one {# день} few {# дня} many {# дней} other {# дня}}.',
    testSubject: 'Тестовое письмо от {company} в Ordler',
    testBody:
      'Это тестовое письмо от {company} в Ordler.\n\nЕсли вы его читаете, настройки почтового сервера работают.',
    notifySubject:
      '{kind, select, issue_assigned {{actor}: вам назначена {item}} issue_commented {{actor}: комментарий к {item}} issue_mentioned {{actor}: вас упомянули в {item}} issue_status_changed {{actor}: изменён статус {item}} approval_requested {Нужно согласование: {item}} approval_decided {{actor}: согласовано {item}} request_rejected {{item}: отклонено} request_changes_requested {{item}: нужны правки} request_received {Новый запрос вашей команде: {item}} request_status_changed {{item}: обновление} request_commented {{actor}: комментарий к {item}} sla_at_risk {SLA под угрозой: {item}} sla_breached {SLA нарушен: {item}} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nОткрыть в Ordler: {url}\n\nРешения и ответы принимаются в Ordler после входа.',
    slackOpen: 'Открыть в Ordler',
    slackEvent:
      '{kind, select, issue_created {Новая задача} issue_status_changed {Изменён статус} issue_assigned {Назначена} issue_commented {Новый комментарий} request_received {Новый запрос} approval_requested {Нужно согласование} approval_decided {Решение по согласованию} request_resolved {Запрос решён} sla_at_risk {SLA под угрозой} sla_breached {SLA нарушен} other {Обновление}}',
    slackTest: 'Ordler подключён к этому каналу для команды {team}.',
  },
  de: {
    otpSubject: '{code} ist dein Anmeldecode für {company}',
    otpBody:
      'Dein Anmeldecode für {company} lautet {code}.\n\nEr ist {minutes, plural, one {# Minute} other {# Minuten}} gültig. Wenn du dich nicht anmelden wolltest, ignoriere diese E-Mail.',
    inviteSubject: 'Einladung zu {company} in Ordler',
    inviteBody:
      'Du wurdest zu {company} in Ordler eingeladen.\n\nÖffne diesen Link, um deinen Namen und dein Passwort festzulegen:\n{url}\n\nDer Link funktioniert einmal und ist {days, plural, one {# Tag} other {# Tage}} gültig.',
    testSubject: 'Test-E-Mail von {company} in Ordler',
    testBody:
      'Dies ist eine Test-E-Mail von {company} in Ordler.\n\nWenn du sie lesen kannst, funktionieren die Mailserver-Einstellungen.',
    notifySubject:
      '{kind, select, issue_assigned {{actor} hat dir {item} zugewiesen} issue_commented {{actor} hat {item} kommentiert} issue_mentioned {{actor} hat Sie in {item} erwähnt} issue_status_changed {{actor} hat den Status von {item} geändert} approval_requested {Genehmigung nötig: {item}} approval_decided {{actor} hat {item} genehmigt} request_rejected {{item} wurde abgelehnt} request_changes_requested {Änderungen angefordert: {item}} request_received {Neue Anfrage für dein Team: {item}} request_status_changed {{item} wurde aktualisiert} request_commented {{actor} hat {item} kommentiert} sla_at_risk {SLA gefährdet: {item}} sla_breached {SLA verletzt: {item}} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nIn Ordler öffnen: {url}\n\nEntscheidungen und Antworten erfolgen in Ordler nach der Anmeldung.',
    slackOpen: 'In Ordler öffnen',
    slackEvent:
      '{kind, select, issue_created {Neue Aufgabe} issue_status_changed {Status geändert} issue_assigned {Zugewiesen} issue_commented {Neuer Kommentar} request_received {Neue Anfrage} approval_requested {Genehmigung angefragt} approval_decided {Genehmigung entschieden} request_resolved {Anfrage gelöst} sla_at_risk {SLA gefährdet} sla_breached {SLA verletzt} other {Aktualisierung}}',
    slackTest: 'Ordler ist für {team} mit diesem Kanal verbunden.',
  },
  az: {
    otpSubject: '{code} — {company} üçün giriş kodunuz',
    otpBody:
      '{company} üçün giriş kodunuz: {code}.\n\nKod {minutes, plural, one {# dəqiqə} other {# dəqiqə}} ərzində etibarlıdır. Əgər daxil olmağa cəhd etməmisinizsə, bu məktubu nəzərə almayın.',
    inviteSubject: 'Ordler-də {company} komandasına dəvət',
    inviteBody:
      'Sizi Ordler-də {company} komandasına dəvət etdilər.\n\nAdınızı və şifrənizi təyin etmək üçün bu linki açın:\n{url}\n\nLink birdəfəlikdir və {days, plural, one {# gün} other {# gün}} ərzində etibarlıdır.',
    testSubject: 'Ordler-də {company} tərəfindən test məktubu',
    testBody:
      'Bu, Ordler-də {company} tərəfindən göndərilən test məktubudur.\n\nOnu oxuya bilirsinizsə, poçt serverinin ayarları işləyir.',
    notifySubject:
      '{kind, select, issue_assigned {{actor}: sizə {item} təyin edildi} issue_commented {{actor}: {item} üzrə şərh} issue_mentioned {{actor} sizi {item} tapşırığında qeyd etdi} issue_status_changed {{actor}: {item} statusu dəyişdi} approval_requested {Təsdiq lazımdır: {item}} approval_decided {{actor}: {item} təsdiqləndi} request_rejected {{item}: rədd edildi} request_changes_requested {{item}: düzəliş tələb olunur} request_received {Komandanıza yeni müraciət: {item}} request_status_changed {{item}: yeniləmə} request_commented {{actor}: {item} üzrə şərh} sla_at_risk {SLA risk altında: {item}} sla_breached {SLA pozuldu: {item}} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nOrdler-də aç: {url}\n\nQərarlar və cavablar sistemə daxil olduqdan sonra Ordler-də verilir.',
    slackOpen: 'Ordler-də aç',
    slackEvent:
      '{kind, select, issue_created {Yeni tapşırıq} issue_status_changed {Status dəyişdi} issue_assigned {Təyin edildi} issue_commented {Yeni şərh} request_received {Yeni müraciət} approval_requested {Təsdiq istənildi} approval_decided {Təsdiq qərarı} request_resolved {Müraciət həll edildi} sla_at_risk {SLA risk altında} sla_breached {SLA pozuldu} other {Yeniləmə}}',
    slackTest: 'Ordler {team} komandası üçün bu kanala qoşulub.',
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

export function renderTestEmail(input: { locale: Locale; company: string }): {
  subject: string;
  text: string;
} {
  const values = { company: input.company };
  return {
    subject: formatEmailMessage(input.locale, 'testSubject', values),
    text: formatEmailMessage(input.locale, 'testBody', values),
  };
}

export function renderNotificationEmail(input: {
  locale: Locale;
  company: string;
  kind: string;
  actor: string;
  item: string;
  title: string;
  url: string;
}): { subject: string; text: string } {
  const subject = formatEmailMessage(input.locale, 'notifySubject', {
    kind: input.kind,
    actor: input.actor,
    item: input.item,
  });
  return {
    subject: `[${input.company}] ${subject}`,
    text: formatEmailMessage(input.locale, 'notifyBody', {
      subject,
      title: input.title,
      url: input.url,
    }),
  };
}
