# Faster database tests

- Date: 2026-10-15
- Area: api, infra
- Spec: none

## Summary

CI failed on a slow runner: the first PGlite boot in a test file exceeded Vitest's 5 s
timeout. Test databases are now cloned from a snapshot migrated once per worker, and
database tests get CI-friendly timeouts. Follows
[2026-10-15-authentication-and-setup](2026-10-15-authentication-and-setup.md).

## Changes

- `apps/api/src/test/pglite.ts` — migrate once per worker, `dumpDataDir` snapshot,
  `loadDataDir` per test.
- `apps/api/vitest.config.ts` — `testTimeout` 30 s, `hookTimeout` 60 s.

## Tests

- Existing API suite (153 tests): summed test time 71.5 s → 28.6 s locally.

## Notes

None.
