# Conditional fields, conditional approval steps and routing rules

- Date: 2026-10-29
- Area: shared, api, web
- Spec: §6.1 (Form, Routing), §6.3 (Condition)

## Summary

Request types can show a form field only when an earlier answer matches, run an approval step
only when the form matches (e.g. amount > 1000), and route requests to another team of the
department by rules on form answers. One condition model backs all three.

## Changes

- `packages/shared/src/requests.ts` — `fieldConditionSchema`, `conditionOpsFor`, `conditionFits`, `matchesCondition`, `conditionAnswers`, `visibleFieldIds`, `routeRequest`; `visibleIf` on fields, `condition` on mandatory steps, `routingRules` on request types; hidden fields are skipped and cleared by `validateFormData`; step status `skipped`.
- `apps/api/drizzle/0024_conditional_steps_routing.sql` — additive: `request_types.routing_rules`, `approval_steps.condition`.
- `apps/api/src/requests/request-types.service.ts` — routing rule teams must belong to the department and be active; views carry rules with team names and step conditions.
- `apps/api/src/requests/request.service.ts` — routing at submit and resubmit (archived rule team falls back to default); non-matching steps stored as skipped; resubmit re-checks steps that have not run.
- `apps/web/src/requests/ConditionEditor.tsx` — field / operator / value editor and pruning of stale conditions on save.
- `apps/web/src/admin/RequestTypesSection.tsx` — "Show if" per field, routing rules editor, "Required if" per step.
- `apps/web/src/requests/common.tsx`, `NewRequestPage.tsx`, `ApprovalTimeline.tsx` — hidden fields, live list of applicable approvals, skipped steps shown as not needed.
- `apps/web/src/i18n/locales/*.json` — `conditions.*`, routing keys, `approvals.status.skipped`, `approvals.skippedNote` in en/ru/de/az.
- `docs/SPEC.md` — condition rules, skipped steps, resubmit re-check.

## Tests

- `packages/shared/src/requests.test.ts` — operators, fitting, routing order, hidden-field cascade, earlier-fields-only, invalid step and rule conditions.
- `apps/api/src/requests/conditions.http.test.ts` — save and view; routing outside the department and unknown fields refused; routing and skipped steps at submit; required only while visible; resubmit re-adds a skipped step and re-routes; decided steps keep their outcome.
- `apps/web/src/admin/RequestTypesSection.test.tsx` — building all three conditions; conditions on a removed field dropped on save.
- `apps/web/src/requests/NewRequestPage.test.tsx` — conditional field, live approvals list.
- `apps/web/src/requests/ApprovalTimeline.test.tsx`, `FormAnswers.test.tsx` — skipped step, hidden answers.

## Notes

One condition per field, step or rule; combining several (and/or) is a possible follow-up.
