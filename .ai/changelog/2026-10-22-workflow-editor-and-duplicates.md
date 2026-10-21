# Workflow editor, team settings and triage duplicates

- Date: 2026-10-22
- Area: api, web, shared
- Spec: §5.1, §5.2

## Summary

Team leads edit their workflow (add, rename, reorder within a category, set the default,
archive unused statuses), manage team labels and Slack channels on one team settings page.
Triage can close an issue as a duplicate of another, linking the original.

## Changes

- `apps/api/drizzle/0013_duplicate_of.sql` — `issues.duplicate_of_id` (additive).
- `apps/api/src/issues/workflow.service.ts` — workflow editor for `team.update`; the default
  status and the last unstarted/completed/canceled status cannot be archived, nor can a
  status in use; changes are audited and pushed to open boards as `team.changed`.
- `apps/api/src/issues/issue.service.ts` — triage `duplicate` action; `duplicateOf` on the
  issue.
- Routes: `POST /api/teams/:key/statuses`, `PUT /api/teams/:key/statuses/order`,
  `PATCH|DELETE /api/statuses/:id`.
- Web: `/teams/KEY/settings` (workflow, labels, Slack) replacing `/integrations`, duplicate
  action in Triage, "Duplicate of" link and history text; boards refetch on `team.changed`;
  i18n en/ru/de/az.

## Tests

- `api/src/issues/workflow.http.test.ts` — add, reorder, rename, default, archive rules,
  denied for members.
- `api/src/issues/issues.http.test.ts` — duplicate triage.
- `web/src/issues/TeamSettingsPage.test.tsx`, `TriagePage.test.tsx`, `Sidebar.test.tsx`.

## Notes

None.
