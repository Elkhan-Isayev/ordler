# Approval timeouts, escalation and delegation

- Date: 2026-10-28
- Area: api, worker, web, shared
- Spec: §6.3

## Summary

Mandatory approval steps can time out after N business hours (the request type's SLA calendar,
around the clock without one): remind the approvers, escalate to a fallback selector or the
approving department's admins, or reject the request. Members can name an out-of-office
delegate for a date range; delegated decisions record both the delegate and the approver.

## Changes

- `packages/shared/src/requests.ts` — `approvalStepConfigSchema` (timeout, fallback selector) for request types, delegation schema and views, `onBehalfOf` / `decidesFor` / `escalatedAt` on approval views.
- `apps/api/drizzle/0023_approval_timeouts_delegation.sql` — step timeout columns, `approval_decisions.on_behalf_of_id`, `approval_delegations` (additive).
- `apps/api/src/approvals/` — `DelegationService` and `/api/me/delegations`.
- `apps/api/src/requests/request.service.ts` — delegation-aware decisions, pending approvals and visibility; delegates notified on activation; timeout runner on worker replicas (reminder halfway, escalation or rejection at the limit, claimed with conditional updates). Timeouts never write approval decisions.
- `apps/api/src/requests/approvers.ts` — escalation approvers.
- Notification kind `approval_reminder` with mail templates in four languages.
- Web: timeout row and fallback selector in the request type step editor, delegation and escalation notes on approvals, Settings → Out of office; locales `en`, `ru`, `de`, `az`.

## Tests

- `apps/api/src/approvals/approvals.http.test.ts` — delegation management (self, overlap, others cannot revoke), delegated decision recorded for both, "all" rule, outside the date range denied, requester as delegate denied, remind / escalate (fallback and department admins) / reject without a decision, business-hours calendar, requester-added steps never time out.
- `apps/web/src/settings/OutOfOfficePage.test.tsx`, `apps/web/src/requests/ApprovalTimeline.test.tsx`, `apps/web/src/admin/RequestTypesSection.test.tsx`.

## Notes

Delegation days are UTC dates. Escalation adds approvers; the original ones may still decide.
