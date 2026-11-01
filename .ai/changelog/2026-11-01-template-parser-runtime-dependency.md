# ICU parser as a runtime dependency

- Date: 2026-11-01
- Area: api, infra
- Spec: §8.2

## Summary

Editable email templates (see `2026-11-01-editable-email-templates.md`) validate text with
`@formatjs/icu-messageformat-parser` at runtime, but it was still a dev dependency, so the
production image failed to start. It is now a regular dependency.

## Changes

- `apps/api/package.json` — `@formatjs/icu-messageformat-parser` 2.11.4 moved to
  `dependencies`.

## Tests

- Built the Docker image locally and ran the CI installer smoke test: `/api/setup/status`
  reports `databaseRequired` and the web app is served.
