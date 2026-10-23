# Sub-issues through the new-issue dialog; clearer due date

- Date: 2026-10-24
- Area: web
- Spec: §5.1, §5.4

## Summary

"Add sub-issue" now opens the same dialog as a new issue, with the parent fixed, so a
sub-issue gets a description, files, assignees and labels from the start ("Create more" adds
several in a row). Due dates show as a "Due date" chip until one is chosen, because an empty
date input looked filled with today's date in Safari.

## Changes

- `apps/web/src/issues/IssueRelations.tsx` — button opens `NewIssueDialog` with `parent`.
- `apps/web/src/issues/NewIssueDialog.tsx` — fixed parent shown instead of the picker.
- `apps/web/src/issues/DueDatePicker.tsx` — chip with native picker and clear button, used on
  the issue page and in the dialog; i18n en/ru/de/az.

## Tests

- `web/src/issues/IssueRelations.test.tsx`, `web/src/issues/DueDatePicker.test.tsx`.

## Notes

None.

"Create more" is renamed to "Keep open for the next issue" with a tooltip explaining what
stays filled in, and after each issue created this way the footer confirms "IT-5 created".
