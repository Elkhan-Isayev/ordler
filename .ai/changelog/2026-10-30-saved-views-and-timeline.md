# Saved views and timeline layout

- Date: 2026-10-30
- Area: shared, api, web, docs
- Spec: §5.4

## Summary

Team issue filters and layout can be saved as personal or shared Views, and issues and projects
gain a timeline layout. Shared views need `view.create_shared`; changes to them are audited.

## Changes

- `packages/shared/src/views.ts` — `VIEW_LAYOUTS`, view filter/input/update schemas, `SavedView`;
  `TeamView.can.shareViews`.
- `apps/api/drizzle/0025_saved_views.sql`, `db/schema.ts` — additive `saved_views` table.
- `apps/api/src/views/` — `ViewService` and `ViewsController`: `GET /api/views`,
  `GET|POST /api/teams/:key/views`, `GET|PATCH|DELETE /api/views/:id`.
- `apps/api/src/issues/team-access.ts` — `shareViews` team permission.
- `apps/web/src/components/Timeline.tsx` — week-grid timeline with a today line.
- `apps/web/src/issues/` — `IssueTimeline`, `SavedViews` (picker, save dialog, `layoutHref`),
  `ViewsPage`; `TeamIssuesPage` gains the timeline tab and the view picker.
- `apps/web/src/projects/ProjectsPage.tsx` — list/timeline toggle.
- `apps/web/src/App.tsx` — `/views`, `/teams/KEY/views`, `/teams/KEY/timeline` routes.
- i18n — `views.*`, `timeline.*`, `issues.timeline` in en, ru, de, az.
- `docs/SPEC.md` §5.4 — view visibility and timeline rules.

## Tests

- `apps/api/src/views/views.http.test.ts` — personal views private to the owner, filter
  validation, unreadable teams, sharing and publishing allowed/denied, audit, `can.shareViews`.
- `apps/web/src/components/Timeline.test.tsx` — range and bar geometry, rendering.
- `apps/web/src/issues/SavedViews.test.tsx` — open, save changes, save as (personal/shared),
  read-only shared view, issue timeline.
- `apps/web/src/issues/ViewsPage.test.tsx`, `projects/projects.test.tsx`, `App.test.tsx`.

## Notes

Migration 0025 is additive. Views are not exposed through the public REST API or MCP yet.
