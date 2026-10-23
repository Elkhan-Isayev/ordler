# Sub-issue order and drag-and-drop reordering

- Date: 2026-10-24
- Area: api, web, shared
- Spec: §5.1

## Summary

Sub-issues used the board order, so the newest came first. They now have their own position:
creation order by default (IT-3 before IT-4), new sub-issues go last, and rows on the parent's
page can be dragged to reorder them among their siblings.

## Changes

- `apps/api/drizzle/0015_sub_issue_order.sql` — `issues.sub_order` (additive, default 0, so
  existing sub-issues keep creation order).
- `apps/api/src/issues/issue.service.ts` — children and grandchildren sorted by `subOrder`
  then number; new or moved sub-issues are appended; `subOrder` updatable, not a history event.
- `apps/web/src/issues/IssueRelations.tsx` — sortable sub-issue lists with a drop line and a
  grip on hover; positions saved as 0..n-1 for changed siblings.

## Tests

- `api/src/issues/labels.http.test.ts` — creation order, append, reorder.
- `web/src/issues/IssueRelations.test.tsx` — `moveBefore` and dragging IT-4 above IT-3.

## Notes

None.
