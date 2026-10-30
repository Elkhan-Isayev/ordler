# Partial project and initiative updates keep omitted fields

- Date: 2026-10-30
- Area: shared, api
- Spec: §5.2

## Summary

`PATCH /api/projects/:id` and `PATCH /api/initiatives/:id` applied the create schema's
defaults to fields the change left out, so renaming a project (or changing its status in the
UI) reset its description, status, lead, dates and members. Update schemas now validate the
same fields without defaults.

## Changes

- `packages/shared/src/projects.ts` — shared field rules; `updateProjectSchema` and
  `updateInitiativeSchema` built from them without defaults.

## Tests

- `apps/api/src/projects/projects.http.test.ts` — renaming keeps every other project and
  initiative field.

## Notes

Affects 0.3.0. Values already reset by earlier edits are not recoverable from Ordler (the
audit entry stores only the new values); restore them by hand or from a database backup.
