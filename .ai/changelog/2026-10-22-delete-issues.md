# Deleting issues

- Date: 2026-10-22
- Area: api, web, shared
- Spec: §14 Phase 1 (Issues: CRUD), §4.3 `issue.delete`

## Summary

Team leads and above can delete issues. Deletion archives the issue instead of erasing it:
it disappears from boards, lists, search and direct links, while the row, history, comments
and an audit entry stay in the database. Open boards drop the card live.

## Changes

- `packages/shared/src/roles.ts` — `issue.delete` for Team Lead (and so Department Admin);
  Org Admin and Owner already hold every permission.
- `apps/api/src/issues/issue.service.ts` — `remove()` sets `archived_at`, audits
  `issue.deleted`, publishes `issue.removed`; `TeamAccess.delete` and `TeamView.can.delete`.
- `DELETE /api/issues/:identifier`; realtime `issue.removed` to team subscribers.
- Web: Delete on the issue page with confirmation, boards drop removed cards; i18n
  en/ru/de/az.

## Tests

- `api/src/issues/issues.http.test.ts` — member denied, lead allowed, 404 afterwards, row and
  audit kept, numbers not reused, event published.
- `web/src/issues/IssuePage.test.tsx`, `TeamIssuesPage.test.tsx`.

## Notes

Restoring archived issues has no UI yet; the data is kept, so it can be added later.
