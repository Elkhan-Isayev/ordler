# MVP acceptance criterion 13 tests

- Date: 2026-10-22
- Area: api, web
- Spec: §14 MVP acceptance criteria

## Summary

Adds explicit tests for criterion 13: an approval link opened without a session returns to
the same page after sign-in, and no endpoint accepts an approval decision without a signed-in
session (neither anonymous nor with a personal token).

## Changes

- Tests only.

## Tests

- `web/src/auth/AuthGate.test.tsx` — deep link survives sign-in.
- `api/src/requests/requests.http.test.ts` — anonymous and bearer decisions answer 401 and
  leave the step active.

## Notes

Criterion 9 (Helm against RDS with `verify-full`) is covered by Helm lint/template in CI and
TLS options in the database probe tests; it still needs one run against a real RDS instance.
