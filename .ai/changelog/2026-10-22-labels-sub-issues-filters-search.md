# Labels, sub-issues, filters and search

- Date: 2026-10-22
- Area: api, web, shared
- Spec: §5.1, §5.4

## Summary

Issues get team and organization labels and sub-issues (same team, any depth, loops refused).
Team lists and boards filter by status, assignee, priority and label with the filter kept in
the URL, and Cmd/Ctrl+K searches issues and requests the member may open.

## Changes

- `apps/api/drizzle/0012_labels_and_sub_issues.sql` — `labels`, `issue_labels`,
  `issues.parent_id` (additive).
- `apps/api/src/issues/label.service.ts` — create (team: issue editors; organization:
  `org.manage`), rename and delete (team managers), unique names per scope.
- `apps/api/src/issues/issue.service.ts` — labels and parent on create/update with history,
  `parent` and `children` on the issue, search over titles, descriptions, comments and
  identifiers in readable teams; `TeamAccess.manage` (team.update).
- `apps/api/src/requests/request.service.ts` — search over requests the member may open
  (comments are never searched, so internal notes cannot surface).
- `GET /api/search`, `POST/PATCH/DELETE /api/labels`; MCP tools take labels, parent and a
  label filter, and `search` uses the new server search.
- Web: label chips, label picker with inline creation, sub-issues and parent on the issue
  page, filter bar with URL state, command palette; i18n en/ru/de/az.

## Tests

- `api/src/issues/labels.http.test.ts` — label permissions, tagging and history, deletion,
  sub-issue rules, search visibility and literal `%`.
- `api/src/requests/requests.http.test.ts` — request search visibility.
- `web/src/issues/filters.test.ts`, `IssueRelations.test.tsx`, `TeamIssuesPage.test.tsx`,
  `IssuePage.test.tsx`, `web/src/components/CommandPalette.test.tsx`.

## Notes

Search uses `ILIKE`; a PostgreSQL full-text index can replace it when volumes need it.
