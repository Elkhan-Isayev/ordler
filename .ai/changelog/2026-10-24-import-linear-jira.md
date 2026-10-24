# Import from Linear and Jira

- Date: 2026-10-24
- Area: api, worker, web, shared, docs
- Spec: §10.2

## Summary

Organization admins can bring issues, comments, files, labels and sub-issues over from Linear
(GraphQL, personal API key) or Jira (Cloud REST v3 with email + API token, Server/DC REST v2
with a personal access token). Runs are resumable, re-runs update instead of duplicating, and
nobody is notified while an import runs.

## Changes

- `docs/adr/0010-import-from-linear-and-jira.md` — runs as rows with a lease, `external_refs`, adapters, converters.
- `apps/api/drizzle/0019_imports.sql` — `import_runs`, `external_refs`, `issues.external_key` (additive).
- `apps/api/src/imports/sources/` — Linear and Jira adapters behind one interface with injected fetch.
- `apps/api/src/imports/markdown.ts` — ADF and wiki markup to Markdown; media link by file name.
- `apps/api/src/imports/import.service.ts` — connect (token sealed), options with email suggestions, configure, dry run, start/pause/cancel, worker runner, writer.
- `apps/api/src/imports/imports.controller.ts` — `/api/admin/imports` (`org.manage`).
- `apps/api/src/issues/issue.service.ts` — old keys (ENG-123) open and find imported issues.
- `apps/api/src/attachments/attachment.service.ts` — `storeAttachment` shared by uploads and the importer.
- `apps/web/src/admin/ImportSection.tsx` — Admin → Import: connect, choose and map, dry run, progress, report.
- `apps/web/src/issues/IssuePage.tsx` — history line "imported from Jira (OPS-12)".
- Locales `en`, `ru`, `de`, `az` — import wizard, errors, history line.

## Tests

- `apps/api/src/imports/markdown.test.ts` — converters.
- `apps/api/src/imports/sources/{linear,jira}.test.ts` — auth headers, paging, mapping, rate limits, foreign download hosts.
- `apps/api/src/imports/imports.http.test.ts` — admin-only, token never returned, mapping checks, dry run, full import without notifications, alias, re-run without duplicates, status mapping, new team, pause/resume, auth failure, rate-limit wait, cancel.
- `apps/web/src/admin/ImportSection.test.tsx` — connect (Linear, Jira Cloud), mapping, dry run, start, report.
- `apps/web/src/issues/IssuePage.test.tsx` — imported history line.

## Notes

Estimates, sprints/cycles and links other than sub-issues are reported as not imported.
Mapped assignees who are not team members join the team.
