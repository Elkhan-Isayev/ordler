import {
  isArgumentElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  parse,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';
import {
  SUPPORTED_LOCALES,
  type EmailTemplateKey,
  type EmailTemplateText,
  type EmailTemplateView,
  type Locale,
} from '@ordler/shared';
import { and, eq } from 'drizzle-orm';
import { IntlMessageFormat } from 'intl-messageformat';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { emailTemplates } from '../db/schema.js';

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
      '{kind, select, issue_assigned {{actor} assigned you {item}} issue_commented {{actor} commented on {item}} issue_mentioned {{actor} mentioned you in {item}} issue_status_changed {{actor} changed the status of {item}} approval_requested {Approval needed: {item}} approval_decided {{actor} approved {item}} request_rejected {{item} was rejected} request_changes_requested {Changes requested on {item}} request_received {New request for your team: {item}} request_status_changed {{item} was updated} request_commented {{actor} commented on {item}} sla_at_risk {SLA at risk: {item}} sla_breached {SLA breached: {item}} approval_reminder {Reminder: your approval is waiting on {item}} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nOpen in Ordler: {url}\n\nDecisions and replies happen in Ordler after signing in.',
    notifySubjectLine: '[{company}] {subject}',
    emailInReceivedSubject: 'Re: {title} [{item}]',
    emailInReceivedBody:
      'Your request {item} was created in {company}.\n\n{title}\n\nFollow it in Ordler: {url}\n\nThis is an automatic reply.',
    emailInRejectedSubject: 'Re: {title}',
    emailInRejectedBody:
      'Ordler could not create a request from your email to {company}.\n\n{reason, select, form_invalid {This request type needs answers to its form.} forbidden {Your account may not submit requests.} request_type_archived {This request type is no longer offered.} other {Something went wrong.}}\n\nSubmit it in Ordler instead: {url}\n\nThis is an automatic reply.',
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
      '{kind, select, issue_assigned {{actor}: вам назначена {item}} issue_commented {{actor}: комментарий к {item}} issue_mentioned {{actor}: вас упомянули в {item}} issue_status_changed {{actor}: изменён статус {item}} approval_requested {Нужно согласование: {item}} approval_decided {{actor}: согласовано {item}} request_rejected {{item}: отклонено} request_changes_requested {{item}: нужны правки} request_received {Новый запрос вашей команде: {item}} request_status_changed {{item}: обновление} request_commented {{actor}: комментарий к {item}} sla_at_risk {SLA под угрозой: {item}} sla_breached {SLA нарушен: {item}} approval_reminder {Напоминание: ждёт вашего согласования {item}} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nОткрыть в Ordler: {url}\n\nРешения и ответы принимаются в Ordler после входа.',
    notifySubjectLine: '[{company}] {subject}',
    emailInReceivedSubject: 'Re: {title} [{item}]',
    emailInReceivedBody:
      'Ваш запрос {item} создан в {company}.\n\n{title}\n\nСледите за ним в Ordler: {url}\n\nЭто автоматический ответ.',
    emailInRejectedSubject: 'Re: {title}',
    emailInRejectedBody:
      'Ordler не смог создать запрос из вашего письма в {company}.\n\n{reason, select, form_invalid {Для этого типа запроса нужно заполнить форму.} forbidden {Вашей учётной записи нельзя создавать запросы.} request_type_archived {Этот тип запроса больше не принимается.} other {Что-то пошло не так.}}\n\nОтправьте его в Ordler: {url}\n\nЭто автоматический ответ.',
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
      '{kind, select, issue_assigned {{actor} hat dir {item} zugewiesen} issue_commented {{actor} hat {item} kommentiert} issue_mentioned {{actor} hat Sie in {item} erwähnt} issue_status_changed {{actor} hat den Status von {item} geändert} approval_requested {Genehmigung nötig: {item}} approval_decided {{actor} hat {item} genehmigt} request_rejected {{item} wurde abgelehnt} request_changes_requested {Änderungen angefordert: {item}} request_received {Neue Anfrage für dein Team: {item}} request_status_changed {{item} wurde aktualisiert} request_commented {{actor} hat {item} kommentiert} sla_at_risk {SLA gefährdet: {item}} sla_breached {SLA verletzt: {item}} approval_reminder {Erinnerung: Ihre Genehmigung für {item} steht aus} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nIn Ordler öffnen: {url}\n\nEntscheidungen und Antworten erfolgen in Ordler nach der Anmeldung.',
    notifySubjectLine: '[{company}] {subject}',
    emailInReceivedSubject: 'Re: {title} [{item}]',
    emailInReceivedBody:
      'Ihre Anfrage {item} wurde in {company} angelegt.\n\n{title}\n\nIn Ordler verfolgen: {url}\n\nDies ist eine automatische Antwort.',
    emailInRejectedSubject: 'Re: {title}',
    emailInRejectedBody:
      'Ordler konnte aus Ihrer E-Mail an {company} keine Anfrage anlegen.\n\n{reason, select, form_invalid {Dieser Anfragetyp braucht Antworten auf sein Formular.} forbidden {Ihr Konto darf keine Anfragen stellen.} request_type_archived {Dieser Anfragetyp wird nicht mehr angeboten.} other {Etwas ist schiefgegangen.}}\n\nStellen Sie sie stattdessen in Ordler: {url}\n\nDies ist eine automatische Antwort.',
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
      '{kind, select, issue_assigned {{actor}: sizə {item} təyin edildi} issue_commented {{actor}: {item} üzrə şərh} issue_mentioned {{actor} sizi {item} tapşırığında qeyd etdi} issue_status_changed {{actor}: {item} statusu dəyişdi} approval_requested {Təsdiq lazımdır: {item}} approval_decided {{actor}: {item} təsdiqləndi} request_rejected {{item}: rədd edildi} request_changes_requested {{item}: düzəliş tələb olunur} request_received {Komandanıza yeni müraciət: {item}} request_status_changed {{item}: yeniləmə} request_commented {{actor}: {item} üzrə şərh} sla_at_risk {SLA risk altında: {item}} sla_breached {SLA pozuldu: {item}} approval_reminder {Xatırlatma: {item} təsdiqinizi gözləyir} other {{item}}}',
    notifyBody:
      '{subject}\n\n{title}\n\nOrdler-də aç: {url}\n\nQərarlar və cavablar sistemə daxil olduqdan sonra Ordler-də verilir.',
    notifySubjectLine: '[{company}] {subject}',
    emailInReceivedSubject: 'Re: {title} [{item}]',
    emailInReceivedBody:
      '{company} daxilində {item} müraciətiniz yaradıldı.\n\n{title}\n\nOrdler-də izləyin: {url}\n\nBu, avtomatik cavabdır.',
    emailInRejectedSubject: 'Re: {title}',
    emailInRejectedBody:
      'Ordler {company} ünvanına göndərdiyiniz məktubdan müraciət yarada bilmədi.\n\n{reason, select, form_invalid {Bu müraciət növü üçün formu doldurmaq lazımdır.} forbidden {Hesabınız müraciət göndərə bilməz.} request_type_archived {Bu müraciət növü artıq qəbul edilmir.} other {Nəsə səhv getdi.}}\n\nOnu Ordler-də göndərin: {url}\n\nBu, avtomatik cavabdır.',
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

/** Which built-in messages back each editable template, and the values it is rendered with. */
export const EMAIL_TEMPLATES = {
  otp: {
    subject: 'otpSubject',
    body: 'otpBody',
    variables: ['code', 'company', 'minutes'],
    required: ['code'],
  },
  invite: {
    subject: 'inviteSubject',
    body: 'inviteBody',
    variables: ['company', 'url', 'days'],
    required: ['url'],
  },
  notification: {
    subject: 'notifySubjectLine',
    body: 'notifyBody',
    variables: ['company', 'subject', 'actor', 'item', 'title', 'url'],
    required: ['url'],
  },
  email_in_received: {
    subject: 'emailInReceivedSubject',
    body: 'emailInReceivedBody',
    variables: ['company', 'item', 'title', 'url'],
    required: ['url'],
  },
  email_in_rejected: {
    subject: 'emailInRejectedSubject',
    body: 'emailInRejectedBody',
    variables: ['company', 'title', 'reason', 'url'],
    required: ['url'],
  },
} as const satisfies Record<
  EmailTemplateKey,
  {
    subject: EmailMessageKey;
    body: EmailMessageKey;
    variables: readonly string[];
    required: readonly string[];
  }
>;

/** Sample values for the admin preview. */
export const EMAIL_TEMPLATE_SAMPLES: Record<EmailTemplateKey, Record<string, string | number>> = {
  otp: { code: '482913', company: 'Ordler', minutes: 10 },
  invite: { company: 'Ordler', url: 'https://ordler.example/invite/…', days: 7 },
  notification: {
    company: 'Ordler',
    subject: 'Ana assigned you ENG-42',
    actor: 'Ana',
    item: 'ENG-42',
    title: 'Fix the VPN timeout',
    url: 'https://ordler.example/issues/ENG-42',
  },
  email_in_received: {
    company: 'Ordler',
    item: 'REQ-17',
    title: 'New laptop for Ana',
    url: 'https://ordler.example/requests/REQ-17',
  },
  email_in_rejected: {
    company: 'Ordler',
    title: 'New laptop for Ana',
    reason: 'form_invalid',
    url: 'https://ordler.example/portal',
  },
};

export type RenderedEmail = { subject: string; text: string };

export function defaultTemplateText(key: EmailTemplateKey, locale: Locale): EmailTemplateText {
  const template = EMAIL_TEMPLATES[key];
  return {
    subject: EMAIL_MESSAGES[locale][template.subject],
    body: EMAIL_MESSAGES[locale][template.body],
  };
}

/**
 * Rejects text that does not parse, names an unknown placeholder or drops a required one;
 * a broken template must fail when saved, not when a sign-in code is due.
 */
export function validateTemplateText(key: EmailTemplateKey, text: EmailTemplateText): void {
  const template = EMAIL_TEMPLATES[key];
  const used = new Set<string>();
  for (const source of [text.subject, text.body]) {
    let ast: MessageFormatElement[];
    try {
      ast = parse(source, { ignoreTag: true });
    } catch {
      throw new DomainError('template_invalid');
    }
    collectArguments(ast, used);
  }
  const allowed: readonly string[] = template.variables;
  if ([...used].some((name) => !allowed.includes(name))) {
    throw new DomainError('template_unknown_variable');
  }
  if (template.required.some((name) => !used.has(name))) {
    throw new DomainError('template_missing_variable');
  }
}

function collectArguments(elements: MessageFormatElement[], into: Set<string>): void {
  for (const element of elements) {
    if (isArgumentElement(element)) into.add(element.value);
    if (isPluralElement(element) || isSelectElement(element)) {
      into.add(element.value);
      for (const option of Object.values(element.options)) collectArguments(option.value, into);
    }
    if (isTagElement(element)) collectArguments(element.children, into);
  }
}

export function renderTemplateText(
  text: EmailTemplateText,
  locale: Locale,
  values: Record<string, string | number>,
): RenderedEmail {
  const format = (source: string) =>
    new IntlMessageFormat(source, locale, undefined, { ignoreTag: true }).format(values) as string;
  return { subject: format(text.subject), text: format(text.body) };
}

/** Renders with the admin's wording for this locale when there is one (SPEC §8.2). */
export async function renderEmail(
  db: Db,
  key: EmailTemplateKey,
  locale: Locale,
  values: Record<string, string | number>,
): Promise<RenderedEmail> {
  const custom = await customText(db, key, locale);
  if (custom) {
    try {
      return renderTemplateText(custom, locale, values);
    } catch {
      // Saved text is validated, but never let a bad row stop a sign-in code from going out.
    }
  }
  return renderTemplateText(defaultTemplateText(key, locale), locale, values);
}

export async function listEmailTemplates(db: Db): Promise<EmailTemplateView[]> {
  const rows = await db.select().from(emailTemplates);
  return (Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[]).map((key) => ({
    key,
    variables: [...EMAIL_TEMPLATES[key].variables],
    required: [...EMAIL_TEMPLATES[key].required],
    locales: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => {
        const fallback = defaultTemplateText(key, locale);
        const row = rows.find((r) => r.key === key && r.locale === locale);
        return [
          locale,
          {
            subject: row?.subject ?? fallback.subject,
            body: row?.body ?? fallback.body,
            customized: Boolean(row),
            default: fallback,
          },
        ];
      }),
    ),
  }));
}

export function renderOtpEmail(
  db: Db,
  input: { locale: Locale; code: string; company: string; minutes: number },
): Promise<RenderedEmail> {
  return renderEmail(db, 'otp', input.locale, {
    code: input.code,
    company: input.company,
    minutes: input.minutes,
  });
}

export function renderInviteEmail(
  db: Db,
  input: { locale: Locale; company: string; url: string; days: number },
): Promise<RenderedEmail> {
  return renderEmail(db, 'invite', input.locale, {
    company: input.company,
    url: input.url,
    days: input.days,
  });
}

export function renderTestEmail(input: { locale: Locale; company: string }): RenderedEmail {
  const values = { company: input.company };
  return {
    subject: formatEmailMessage(input.locale, 'testSubject', values),
    text: formatEmailMessage(input.locale, 'testBody', values),
  };
}

export function renderNotificationEmail(
  db: Db,
  input: {
    locale: Locale;
    company: string;
    kind: string;
    actor: string;
    item: string;
    title: string;
    url: string;
  },
): Promise<RenderedEmail> {
  // The event line stays built in (one phrase per event kind); admins reword around it.
  const subject = formatEmailMessage(input.locale, 'notifySubject', {
    kind: input.kind,
    actor: input.actor,
    item: input.item,
  });
  return renderEmail(db, 'notification', input.locale, {
    company: input.company,
    subject,
    actor: input.actor,
    item: input.item,
    title: input.title,
    url: input.url,
  });
}

export async function saveEmailTemplate(
  db: Db,
  key: EmailTemplateKey,
  locale: Locale,
  text: EmailTemplateText,
  actor: AuditActor & { id: string },
): Promise<void> {
  validateTemplateText(key, text);
  const before = await customText(db, key, locale);
  const values = {
    subject: text.subject,
    body: text.body,
    updatedAt: new Date(),
    updatedBy: actor.id,
  };
  await db
    .insert(emailTemplates)
    .values({ key, locale, ...values })
    .onConflictDoUpdate({ target: [emailTemplates.key, emailTemplates.locale], set: values });
  await writeAudit(db, {
    actor,
    action: 'email_template.updated',
    targetType: 'email_template',
    // `template`, not `key`: the audit writer redacts anything named like a secret key.
    before: { template: key, locale, ...(before ?? { customized: false }) },
    after: { template: key, locale, ...text },
  });
}

/** Back to the built-in text; a no-op when nothing was customized. */
export async function resetEmailTemplate(
  db: Db,
  key: EmailTemplateKey,
  locale: Locale,
  actor: AuditActor & { id: string },
): Promise<void> {
  const before = await customText(db, key, locale);
  if (!before) return;
  await db
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.locale, locale)));
  await writeAudit(db, {
    actor,
    action: 'email_template.reset',
    targetType: 'email_template',
    before: { template: key, locale, ...before },
    after: { template: key, locale, customized: false },
  });
}

async function customText(
  db: Db,
  key: EmailTemplateKey,
  locale: Locale,
): Promise<EmailTemplateText | undefined> {
  const [row] = await db
    .select({ subject: emailTemplates.subject, body: emailTemplates.body })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.locale, locale)));
  return row;
}
