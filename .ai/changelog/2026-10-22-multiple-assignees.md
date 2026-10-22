# Several assignees per issue (team setting)

- Date: 2026-10-22
- Area: api, web, shared, docs
- Spec: §5.1 Assignee

## Summary

Teams can allow several assignees per issue, ClickUp-style; by default an issue still has one.
Admins toggle it per team in Administration → Departments, team leads in team settings.

## Changes

- `apps/api/drizzle/0014_multiple_assignees.sql` — `teams.multiple_assignees`,
  `issue_assignees` (ordered), backfilled from `issues.assignee_id`, which stays the first
  assignee (expand/contract).
- `apps/api/src/issues/issue.service.ts` — `assigneeIds` on create/update, `single_assignee`
  for one-assignee teams, history, notifications only for newly added people, My issues for
  every assignee; `TeamView.settings`.
- `PATCH /api/admin/teams/:id` accepts `multipleAssignees`; MCP issue tools take `assignees`.
- Web: assignee picker (select, or checkboxes when allowed), avatar stacks on board and list,
  filter by any assignee, admin and team-settings toggles; i18n en/ru/de/az.
- `docs/SPEC.md` §5.1 — assignee row.

## Tests

- `api/src/issues/assignees.http.test.ts`, `api/src/db/migrations.test.ts` (backfill),
  `api/src/mcp/mcp.http.test.ts`.
- `web/src/issues/AssigneePicker.test.tsx`, `web/src/admin/DepartmentsSection.test.tsx`.

## Notes

None.
