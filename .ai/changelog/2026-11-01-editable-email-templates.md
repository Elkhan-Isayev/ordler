# Editable email templates

- Date: 2026-11-01
- Area: api, web, shared
- Spec: §8.2

## Summary

Admins can reword the sign-in code, invitation and notification emails per language, preview
them with sample values and reset them to the built-in text.

## Changes

- `apps/api/drizzle/0026_email_templates.sql` — `email_templates` (key, locale) with subject
  and body; no row means the built-in text.
- `apps/api/src/mail/templates.ts` — template definitions with allowed and required
  placeholders, validation with the ICU parser, `renderEmail` that prefers the admin text and
  falls back to the built-in one, audited save and reset.
- OTP, invite and notification senders render through the database.
- `GET/PUT/DELETE /api/admin/mail/templates/:key/:locale` and `POST …/preview`, behind
  `mail.manage`.
- `apps/web/src/admin/EmailTemplates.tsx` — editor in Admin → Mail with placeholders, preview,
  save and reset; strings in all four locales.

## Tests

- Built-in text passes validation in every locale; custom text applies to its locale only;
  reset; syntax, unknown and missing placeholders refused; tags stay plain text; audit rows.
- HTTP: list, preview, save, reset, 400 for a missing `{code}`, 404 for unknown template or
  locale, 403 without `mail.manage`.
- Web: save for a chosen language, preview, error message, reset.

## Notes

Audit payloads name the template `template`, because the audit writer redacts fields called
`key`.
