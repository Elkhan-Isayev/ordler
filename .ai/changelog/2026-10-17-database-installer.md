# First-run database installer and Admin → Database

- Date: 2026-10-17
- Area: api, web, shared, docs
- Spec: §4.2, §8, §16.2, §16.4; ADR 0006

## Summary

Ordler can now start with no database configured: it serves an installer page that asks for
the PostgreSQL connection and a one-time install token from the log, checks it, saves it to
the data volume and starts the application, which creates every table itself. Admins see the
connection in Admin → Database; Owners can change installer-saved settings.

## Changes

- `packages/shared/src/database.ts` — connection schemas, probe errors, views, setup status.
- `packages/shared/src/permissions.ts`, `roles.ts` — `instance.manage`, Owner only.
- `apps/api/src/config/env.ts` — database and `ENCRYPTION_KEY` optional; `ORDLER_DATA_DIR`,
  `ORDLER_INSTALL_TOKEN`, `ORDLER_WEB_DIR`.
- `apps/api/src/config/data-dir.ts` — generated encryption key and `database.json` with the
  password sealed, atomic owner-only writes.
- `apps/api/src/db/probe.ts` — reachability, credentials, PostgreSQL 18+, CREATE privilege,
  error classification.
- `apps/api/src/install/installer.ts` — installer server with token, origin check and rate
  limit; hands over to the application after saving.
- `apps/api/src/install/database-settings.service.ts`, `admin-database.controller.ts` —
  `GET/PUT /api/admin/database`.
- `apps/api/src/http/web-assets.ts` — the API serves the built web app with SPA fallback
  (`@fastify/static`).
- `apps/api/src/main.ts` — env → saved settings → installer, then the application.
- `apps/web/src/database/*` — installer page and shared connection fields;
  `apps/web/src/admin/DatabaseSection.tsx`; i18n in en/ru/de/az.

## Tests

- `config/data-dir.test.ts`, `db/probe.test.ts` (real SQL on PGlite), `install/installer.test.ts`,
  `install/admin-database.http.test.ts` (Owner allowed, Org Admin denied), `http/web-assets.test.ts`,
  `config/env.test.ts`.
- `database/DatabaseSetupPage.test.tsx`, `admin/DatabaseSection.test.tsx`, `auth/AuthGate.test.tsx`.

## Notes

New dependency `@fastify/static` 10.1.4 (MIT). No migration. Installer mode needs a writable
volume and a single replica (ADR 0006).
