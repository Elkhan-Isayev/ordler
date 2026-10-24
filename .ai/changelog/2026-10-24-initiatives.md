# Initiatives

- Date: 2026-10-24
- Area: api, web, shared
- Spec: §5.2 Initiatives, §14 Phase 2

## Summary

Initiatives group projects under an organizational objective with an owner, status, target
date, a health roll-up (the worst health among running projects) and combined progress.
Everyone can read them; each viewer sees only the projects they may see.

## Changes

- `apps/api/drizzle/0018_initiatives.sql` — `initiatives`, `initiative_projects` (additive).
- `apps/api/src/projects/initiative.service.ts` — created with `initiative.manage`, edited by
  the owner too; setting projects keeps ones the editor cannot see; archived, never erased;
  audited. Routes under `/api/initiatives`.
- Web: `/initiatives` and `/initiatives/:id` (owner, status, target date, health, progress,
  description, add/remove projects); i18n en/ru/de/az.

## Tests

- `api/src/projects/projects.http.test.ts` — permissions, visibility, roll-ups, hidden
  projects kept; `api/src/projects/initiative.service.test.ts` — health roll-up.
- `web/src/projects/initiatives.test.tsx`.

## Notes

None.
