# Stable board deletion test

- Date: 2026-10-29
- Area: web
- Spec: none

## Summary

The test for issues deleted by other people failed on slow CI runners: a list reload that
landed after the realtime event returned the deleted issue again. The mocked server now stops
returning it once deleted, as the real one does.

## Changes

- `apps/web/src/issues/TeamIssuesPage.test.tsx` — deletion-aware list mock.

## Tests

- Same test, now independent of request timing.

## Notes

None
