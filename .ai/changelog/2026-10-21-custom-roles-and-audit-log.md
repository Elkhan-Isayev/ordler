# Custom roles and the audit log viewer

- Date: 2026-10-21
- Area: api, web, shared
- Spec: §4.1, §8, §9; MVP criterion 5

## Summary

Admins create, edit and delete custom roles from the permission catalog, and read the audit
log with filters and paging. Roles cannot be used to escalate: an editor may only include
permissions they hold organization-wide, and `instance.manage` stays Owner-only.

## Changes

- `apps/api/src/members/roles.service.ts` — create/update/delete custom roles (`role.create`,
  `role.update`, `role.delete`); system roles read-only, unique names, roles in use cannot be
  deleted; every change audited with before/after.
- `apps/api/src/audit/audit.service.ts`, `apps/api/src/admin/admin-roles.controller.ts` —
  `GET /api/admin/audit` (`org.audit.read`), newest first, filters by action, target type,
  actor, keyset paging by uuidv7 id.
- `packages/shared/src/admin.ts` — role and audit schemas, views, error codes.
- Web: Admin → Roles and Admin → Audit log; i18n en/ru/de/az.

## Tests

- `api/src/admin/admin-roles.http.test.ts` — custom role grants, edit/delete rules,
  escalation denied, audit filters and paging.
- `web/src/admin/RolesSection.test.tsx`, `web/src/admin/AuditSection.test.tsx`.

## Notes

None.
