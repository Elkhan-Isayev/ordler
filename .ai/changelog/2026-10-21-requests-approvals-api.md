# Requests, approvals and request groups (API)

- Date: 2026-10-21
- Area: api, shared
- Spec: §6.1–§6.4, §9; MVP criteria 2, 3, 4, 5, 6, 12

## Summary

Departments offer request types with forms and mandatory approval steps. Members submit
requests (optionally adding approvals), approvers decide step by step with segregation of
duties, and released requests land in the target team's queue with a full lifecycle,
public/internal comments and linked issues. One request can go to several departments as a
request group with group-level approvals.

## Changes

- `packages/shared/src/requests.ts` — form fields and `validateFormData`, approver selectors,
  request/type/group/approval views and schemas, identifiers `REQ-n` / `REQ-G-n`.
- `apps/api/drizzle/0009_requests_and_approvals.sql` — `request_types`, `requests`,
  `request_groups`, `approval_steps`, append-only `approval_decisions`, `request_events`,
  `counters`, `issues.source_request_id` (additive).
- `apps/api/src/requests/approvers.ts` — selectors `user`, `role@department`,
  `department_head`, `requester_department_supervisor`; requester excluded, fallback to the
  department's admins, then Owners.
- `apps/api/src/requests/request-types.service.ts` — portals and request type management
  (request_type.manage on the department).
- `apps/api/src/requests/request.service.ts` — submission, sequential steps with any/all,
  approve / reject / request changes / resubmit, session-only decisions, audit with snapshot
  hash, team lifecycle, requester confirm/reopen, comments, spawn/link issues, groups.
- `apps/api/src/requests/requests.controller.ts` — routes under `/api/portals`,
  `/api/requests`, `/api/request-groups`, `/api/approvals`, `/api/me/requests|approvals`.
- `apps/api/src/notifications/notifier.ts` — notification interface used by requests.
- Departments can have a head (`PATCH /api/admin/departments/:id` `headMemberId`).

## Tests

- `requests/requests.http.test.ts` — CS → Finance → IT flow, rejection with reason, SoD,
  user / head / all selectors, decision rules and repeats, audit, token decisions refused,
  changes requested and resubmit, form and approval validation, internal comments hidden,
  lifecycle, decline, spawned issues, visibility, groups released and rejected, request type
  permissions and routing, portals and archived types.
- `packages/shared/src/requests.test.ts` — form validation and schemas.

## Notes

Group-level steps allow approve and reject only. SLA (§6.5) is Phase 2.
