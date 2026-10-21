# Service portals, requests and approvals in the web app

- Date: 2026-10-21
- Area: web, api, shared
- Spec: §6.1–§6.4; MVP criteria 2, 3, 12, 13

## Summary

Members submit requests from department portals, including one request to several
departments, and may add approvals such as Finance. Approvers decide on the request page or
from the Approvals list, the receiving team works requests from its queue, and admins build
request types with forms and approval chains.

## Changes

- `apps/web/src/requests/` — portals (pick types of several departments for a group), new
  request and group forms with client-side form validation and requester-added approvals,
  request page (answers, approval timeline with approve / request changes / reject, team
  actions, assignee and priority, public and internal comments, linked issues, resubmit,
  confirm or reopen), My requests, Approvals, team and department queues, group page.
- `apps/web/src/admin/RequestTypesSection.tsx` — request type editor: target team, form
  fields, mandatory approval chain, requester-added approvals; department heads in
  Departments.
- `apps/api/src/members/directory.ts` — `GET /api/directory` (names only) for pickers.
- Routes, sidebar "Requests" per team, avatar initials from letters only; i18n en/ru/de/az.

## Tests

- `requests/NewRequestPage.test.tsx`, `RequestPage.test.tsx`, `RequestLists.test.tsx`,
  `admin/RequestTypesSection.test.tsx`, `issues/ui.test.tsx`; API directory test.
- Verified live: CS agent submits with a Finance approval, signs out; the CS supervisor opens
  the request link, signs in and lands on it (criterion 13), approves; Finance approves; the
  request appears in the IT queue and the team lead accepts it.

## Notes

Option text in the request type editor keeps commas while typing (found by its test).
