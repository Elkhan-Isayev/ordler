# Triage realtime test independent of timing

- Date: 2026-11-01
- Area: web
- Spec: §5.2

## Summary

`TriagePage` "follows filings and decisions made elsewhere" failed on a slow CI runner: the
realtime event was pushed before the socket subscribed and was lost. The test now repeats
the idempotent event until the page reacts, like the board deletion test
(`2026-10-29` fix).

## Changes

- `apps/web/src/issues/TriagePage.test.tsx` — push inside `waitFor`.

## Tests

- The test passes repeatedly locally; no product code changed.
