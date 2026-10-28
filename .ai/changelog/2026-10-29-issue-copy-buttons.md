# Copy issue ID and link from the issue header

- Date: 2026-10-29
- Area: web
- Spec: none

## Summary

The issue page header has two Linear-style buttons that copy the identifier and the issue URL,
with a short "copied" confirmation. Copying now also works on plain-http on-prem installs,
where the async Clipboard API is unavailable.

## Changes

- `apps/web/src/components/clipboard.ts` — `copyText` with a legacy copy-command fallback.
- `apps/web/src/issues/IssuePage.tsx` — copy ID and copy link buttons next to the identifier.
- `apps/web/src/issues/IssueContextMenu.tsx`, `admin/MembersSection.tsx`, `settings/TokensPage.tsx` — use `copyText`.
- `apps/web/src/i18n/locales/*.json` — `issues.copiedId`, `issues.copiedLink` in en/ru/de/az.

## Tests

- `apps/web/src/components/clipboard.test.ts` — Clipboard API, fallback, both blocked.
- `apps/web/src/issues/IssuePage.test.tsx` — copies ID and link, fallback, blocked copy stays quiet.

## Notes

None
