# Clear issue key field when adding a team

- Date: 2026-10-22
- Area: web
- Spec: §5.1

## Summary

The team form only showed a bare `HELP` placeholder, which read like a word rather than an
example. Both fields now have visible labels, and a live line shows how issues of the new
team will be numbered (e.g. `PLAT-1, PLAT-2…`).

## Changes

- `apps/web/src/admin/DepartmentsSection.tsx` — labelled name and issue key fields, live
  numbering preview; i18n en/ru/de/az.

## Tests

- `web/src/admin/DepartmentsSection.test.tsx` — new labels and the preview.

## Notes

None.
