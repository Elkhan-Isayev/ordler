# Rename and restore departments in the admin UI

- Date: 2026-11-12
- Area: web, api
- Spec: §4 (departments), §8 (admin)

## Summary

Admins can rename a department inline in Settings → Departments and bring an archived
department back. Restoring also brings back the teams that were archived together with it;
teams archived on their own earlier stay archived.

## Changes

- apps/api/src/org — `POST /api/admin/departments/:id/restore` (permission `department.archive`),
  refuses a name now taken by an active department, writes `department.restored` to the audit log.
- apps/web/src/admin/DepartmentsSection.tsx — rename button and inline form; "Restore" on archived departments.
- apps/web/src/api/client.ts — `restoreDepartment`.
- Locales en/ru/de/az — `admin.departments.{rename,renameFor,save,cancel,restore}`.
- docs/SPEC.md — restore rule.

## Tests

- apps/api/src/members/admin.http.test.ts — restore with teams, name conflict, denied for a plain member.
- apps/web/src/admin/DepartmentsSection.test.tsx — inline rename, name conflict keeps the form, restore.
