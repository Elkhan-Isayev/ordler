# Tables in the public schema by default

- Date: 2026-10-24
- Area: api, web, infra, docs
- Spec: §16.2, §16.3

## Summary

New installations keep their tables in `public`, like Wiki.js, which is what DBAs and tools
expect in a dedicated `ordler` database. Installations created with the old `ordler` default
keep working without any change: when no schema is configured, startup finds their data in
`ordler` and stays there.

## Changes

- `apps/api/src/db/schema-default.ts` — `public` default; `resolveDefaultSchema` keeps an
  install whose migrations live in `ordler` (and not in `public`).
- `apps/api/src/config/env.ts`, `apps/api/src/main.ts` — `DB_SCHEMA` optional; resolved with one
  short connection before the pool starts; logged when the legacy schema is kept.
- Installer form defaults to `public`; Helm `database.schema` defaults to empty (auto) and
  `DB_SCHEMA` is only set when given.
- `README.md`, `docs/install.md`, `docs/SPEC.md` — new default and how to share a database.

## Tests

- `api/src/db/schema-default.test.ts` — fresh database, legacy install, both present.
- `api/src/config/env.test.ts`, `web/src/database/DatabaseSetupPage.test.tsx`.
- Checked live with Docker: an install made by 0.2.2 without `DB_SCHEMA` upgraded to this
  build kept its workspace in `ordler` with no tables created in `public`; a fresh database got
  its tables in `public`.

## Notes

Installs set up through the install page stored their schema explicitly and are unaffected.
Moving an existing install from `ordler` to `public` is not automatic (it would need a
data move); set `DB_SCHEMA=ordler` to make the current state explicit.
