# Card dragging and the right-click issue menu

- Date: 2026-10-22
- Area: web
- Spec: §5.4

## Summary

Dragging a card on the board now moves the card itself, as in Trello or Linear, instead of a
browser link preview; a line shows where it will land and the column lights up. Right-clicking
a card or list row opens an issue menu to change status, priority, assignees and labels,
copy the link or ID, open it in a new tab, or delete it.

## Changes

- `apps/web/src/issues/IssueBoard.tsx` — the list item is dragged with the card as drag
  image, the inner link is not draggable, drop indicator and column highlight.
- `apps/web/src/issues/IssueContextMenu.tsx` — menu with submenus; actions respect
  `team.can` and go through the usual optimistic update.
- `TeamIssuesPage`, `IssueList`, `useTeamIssues.remove`; i18n en/ru/de/az.

## Tests

- `web/src/issues/IssueContextMenu.test.tsx`, `web/src/issues/TeamIssuesPage.test.tsx`.

## Notes

None.
