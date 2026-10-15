# Local development on PostgreSQL 18 and DB_SCHEMA migration fix

- Date: 2026-10-15
- Area: api, infra, docs
- Spec: §16.2, §16.3

## Summary

First run against a real PostgreSQL 18 server found a bug: drizzle-kit generated foreign keys
as `REFERENCES "public"."table"`, but Ordler creates tables in its own schema (`DB_SCHEMA`,
default `ordler`), so the first migration failed on every default installation. PGlite tests
missed it because they used the public schema. The failed run rolled back completely, as
designed.

## Changes

- `apps/api/drizzle/0000_init.sql`, `0001_auth.sql` — unqualified references (no release has
  shipped, so editing them is safe).
- `apps/api/scripts/unqualify-migrations.mjs`, `db:generate` runs it after drizzle-kit.
- `apps/api/src/test/pglite.ts` — test databases now use a dedicated `ordler` schema, like
  production.
- `scripts/dev-db.sh` (project-local PostgreSQL 18 cluster in `.data/`, port 5433) and
  `scripts/dev-api.sh` (runs the built API against it, and reports a busy port instead of a
  stack trace); `.data/` is git-ignored.
- `README.md` — local development instructions.

## Tests

- `apps/api/src/db/migrations.test.ts` — migrations apply inside a non-public schema and no
  migration hard-codes `"public".` (red before the fix, green after).

## Notes

Verified manually: the API starts on PostgreSQL 18.6, applies 0000–0002 into `ordler`, leaves
`public` empty and reports ready.
