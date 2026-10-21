# Triage and easier team access

- Date: 2026-10-21
- Area: api, web, shared
- Spec: §5.2 (Triage), §5.3

## Summary

Issues filed by people outside a team now wait in the team's Triage until a member accepts
them (choosing status and assignee) or declines them with a reason the filer can read.
Whoever creates a team joins it, so it shows up in their sidebar, and team names in
Administration link to the board.

## Changes

- `apps/api/drizzle/0008_issue_triage.sql` — `issues.in_triage` (additive).
- `apps/api/src/issues/issue.service.ts`, `issues.controller.ts` — triage on create for
  non-members, `GET /api/teams/:key/triage`, `POST /api/issues/:identifier/triage`
  (accept/decline, issue.update required, assign checked separately), board and list exclude
  triage, decisions recorded in history; decline reason posted as a comment.
- `apps/api/src/org/org.service.ts` — the creator joins the new team.
- `packages/shared/src/issues.ts` — `inTriage`, `triageActionSchema`, `not_in_triage`.
- `apps/web/src/issues/TriagePage.tsx` (`/teams/KEY/triage`), board filter, history lines,
  admin team links; i18n for en, ru, de, az.

## Tests

- `issues/issues.http.test.ts` — creator membership, triage on outside filings, accept with
  status and assignee, double decision refused, decline with reason, viewer denied,
  validation.
- `issues/TriagePage.test.tsx` — accept, decline, live filings and decisions, viewers.
- `admin/DepartmentsSection.test.tsx`, `members/admin.http.test.ts` — updated.

## Notes

Duplicate marking and snoozing from SPEC §5.2 come later.
