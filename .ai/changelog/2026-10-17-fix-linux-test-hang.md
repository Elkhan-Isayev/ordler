# Fix API tests hanging on Linux CI

- Date: 2026-10-17
- Area: api
- Spec: —

## Summary

The API test suite never finished on Linux: a data-directory test wrote below `/proc`, which
blocks there instead of failing, and many parallel workers each holding PostgreSQL in memory
could stall the run.

## Changes

- `apps/api/src/config/data-dir.test.ts` — the unwritable path is now below a regular file
  (ENOTDIR on every OS, also for root).
- `apps/api/vitest.config.ts` — at most 4 workers.

## Tests

- Full API suite run on Linux (`node:24-bookworm-slim`) in Docker: 29 files, 287 tests.

## Notes

None.
