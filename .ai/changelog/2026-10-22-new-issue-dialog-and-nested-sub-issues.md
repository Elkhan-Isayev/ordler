# New issue dialog and nested sub-issues

- Date: 2026-10-22
- Area: api, web, shared
- Spec: §5.1, §5.4

## Summary

The new-issue dialog follows Linear: a large title, a roomy description that takes pasted
text, screenshots and files, and one row of properties (status, priority, assignees, labels,
due date, parent issue), with Ctrl/Cmd+Enter and "Create more". Issue pages show two levels of
sub-issues as a tree and the parent chain in the header.

## Changes

- `IssueDetail.grandchildren` and `IssueDetail.ancestors` (root first, bounded).
- `apps/web/src/issues/NewIssueDialog.tsx` — redesigned dialog; scrolls inside the window and
  keeps large images in check.
- `apps/web/src/issues/IssueRelations.tsx`, `IssuePage.tsx` — nested tree, breadcrumbs.
- i18n en/ru/de/az.

## Tests

- `api/src/issues/labels.http.test.ts` — grandchildren and ancestors.
- `web/src/issues/NewIssueDialog.test.tsx`, `IssueRelations.test.tsx`, `IssuePage.test.tsx`.

## Notes

None.
