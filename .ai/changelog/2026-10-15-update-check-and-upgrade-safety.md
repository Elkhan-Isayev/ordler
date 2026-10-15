# Update check and upgrade safety (API part)

- Date: 2026-10-15
- Area: api, shared
- Spec: §16.3, §16.5 (to be written)

## Summary

Daily anonymous check of GitHub releases with an admin endpoint, and guarantees that
upgrades never lose data. Follows [2026-10-15-faster-database-tests](2026-10-15-faster-database-tests.md).

## Changes

- Config: `ORDLER_VERSION`, `UPDATE_CHECK`, `UPDATE_CHECK_REPOSITORY`.
- `apps/api/src/updates/*` — semver, GitHub release lookup (ETag, stable releases only),
  `UpdateService` (stored result, daily schedule, keeps last release on errors),
  `GET /api/admin/updates`, `POST /api/admin/updates/check` (`org.manage`).
- Migration `0002_update_status`.
- `schema-compat.ts` — refuses to start on a schema migrated by a newer version; with
  `ORDLER_MIGRATE=false` refuses to start while migrations are pending.
- `migration-lint.ts` — destructive SQL needs `-- ordler:allow-destructive <reason>`.
- `/api/me` returns `organizationPermissions`.

## Tests

- version, GitHub lookup, update service, config, HTTP endpoints; migration tests: lint of
  every file, data written before each migration survives it, first release → latest keeps
  every row, a failing migration rolls back all pending ones (API: 211 tests).

## Notes

Not done yet: web admin banner, SPEC §16.5 / ADR 0005 / CLAUDE.md rule, README, Miro.
