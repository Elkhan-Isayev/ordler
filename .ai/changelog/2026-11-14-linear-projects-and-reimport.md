# Linear projects, retrying imports and clearing a department

- Date: 2026-11-14
- Area: api, web, shared
- Spec: §10.2

## Summary

Imports from Linear now bring projects over. Failed import runs can be retried from where they
stopped, and a re-run fills in files and projects an earlier run missed. Admins can delete all
issues of a department to import them again from scratch.

## Changes

- apps/api/src/imports/sources/linear.ts — reads each issue's project (name, description, state,
  lead, dates); `ExternalProject` in `sources/types.ts`.
- apps/api/src/imports/import.service.ts — creates one Ordler project per Linear project
  (`external_refs` kind `project`) linked to the target team and sets `issues.project_id`;
  unchanged issues are still updated when a project or a file is missing; `start` resumes a
  failed run; `clearDepartment` deletes (archives) a department's issues and forgets their
  issue, comment and attachment refs.
- apps/api/src/org/admin-org.controller.ts — `POST /api/admin/departments/:id/clear-issues`
  (`org.manage`), audited as `department.issues_cleared`; new error `import_running`.
- apps/web/src/admin/DepartmentsSection.tsx — "Delete all issues" confirmed by typing the name.
- apps/web/src/admin/ImportSection.tsx — "Retry" on a failed run.
- Locales en/ru/de/az — new keys under `admin.departments`, `imports.retry`, `errors.import_running`.

## Tests

- apps/api/src/imports/sources/linear.test.ts — project mapping.
- apps/api/src/imports/imports.http.test.ts — projects created once and linked; re-run fills in
  a missing project and file; retry of a failed run; clearing a department then re-importing;
  denied for non-admins and while an import is running.
- apps/web/src/admin/DepartmentsSection.test.tsx — typed confirmation, result, import_running error.
- apps/web/src/admin/ImportSection.test.tsx — retry shown only for failed runs.

## Notes

No migration: `external_refs.kind` is plain text.
