# Mail server settings in the admin panel

- Date: 2026-10-17
- Area: api, web, shared
- Spec: §8.2

## Summary

On-premises admins can now configure SMTP in Admin → Mail server instead of environment
variables, and send a test email that shows the SMTP error verbatim. SMTP_* variables still win
and are shown read-only.

## Changes

- `packages/shared/src/mail.ts` — settings and test-email schemas, `MailSettingsView`.
- `apps/api/src/db/schema.ts`, `drizzle/0004_mail_settings.sql` — single-row `mail_settings`
  table; the password is sealed with ENCRYPTION_KEY.
- `apps/api/src/mail/mail.service.ts` — one mailer for every feature: env settings first, then
  the database row (15 s cache so other replicas follow admin changes).
- `apps/api/src/mail/admin-mail.controller.ts` — `GET/PUT /api/admin/mail`,
  `POST /api/admin/mail/test` behind `mail.manage`, rate-limited tests.
- `apps/api/src/auth/strategies.ts` — email OTP usability follows the live mail status.
- `apps/api/src/mail/templates.ts` — localized test email.
- `apps/web/src/admin/MailSection.tsx` — form, write-only password, test email; i18n in
  en/ru/de/az.

## Tests

- `apps/api/src/mail/mail.service.test.ts` — encryption, write-only password, env precedence,
  replica cache, audit redaction, test-email result.
- `apps/api/src/mail/admin-mail.http.test.ts` — allowed and denied paths, OTP availability.
- `apps/web/src/admin/MailSection.test.tsx` — save, keep password, env read-only, test email.

## Notes

Migration `0004_mail_settings` is additive. DKIM and delivery retries stay open (§8.2).
