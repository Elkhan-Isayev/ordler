# Phase 2 verification fixes

- Date: 2026-11-01
- Area: web
- Spec: §8.2, §10.1

## Summary

Small fixes found while checking email-in, email templates, the Slack app and MCP OAuth on a
live stand (PostgreSQL 18 and a GreenMail IMAP/SMTP server).

## Changes

- `apps/web/vite.config.ts` — the dev server proxies `/.well-known/oauth-*`, so MCP clients
  can discover OAuth against a development setup.
- `apps/web/src/admin/EmailTemplates.tsx` — space between the placeholder list and the
  "Required" note.

## Tests

- Existing template editor tests; live check: an email to a request type address became
  REQ-1 with a threaded `Auto-Submitted` confirmation, a stranger's email was logged without
  reply, the consent page issued a code with the narrowed scopes, `state` and `iss`.
