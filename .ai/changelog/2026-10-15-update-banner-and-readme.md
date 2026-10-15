# Update banner, README and upgrade-safety docs

- Date: 2026-10-15
- Area: web, docs
- Spec: §8, §16.5, §17

## Summary

Admins now see a "new version available" banner with upgrade instructions; the README was
rewritten with the logo, screenshots, diagrams and the data-safety guarantees. Completes
[2026-10-15-update-check-and-upgrade-safety](2026-10-15-update-check-and-upgrade-safety.md).

## Changes

- `apps/web/src/components/UpdateBanner.tsx` — shown to `org.manage` members only, release
  notes link, major-version warning, Compose/Helm commands, dismiss per version.
- `apps/web/src/App.tsx`, `api/client.ts`, locales en/ru/de/az (`updates.*`).
- `README.md` — hero with logo and badges, features with status, screenshots, request flow
  and architecture diagrams, getting started, configuration, upgrades, security, layout.
- `docs/assets/screenshots/*` — taken from the running app (dev API on PGlite).
- `docs/SPEC.md` v0.6 — §16.5 Updates and data safety, telemetry note, admin overview row.
- `docs/adr/0005-update-check-and-upgrade-safety.md`, `CLAUDE.md` migration rule.

## Tests

- `apps/web/src/components/UpdateBanner.test.tsx` — admin-only fetch, up-to-date, major
  warning, instructions, dismiss until a newer release, API failure (7 tests).

## Notes

Found while taking screenshots: both upgrade alternatives were numbered "2."; the Helm line
now reads as an alternative in all four languages.
