# Specification: import from Linear and Jira (Phase 2)

- Date: 2026-10-24
- Area: docs
- Spec: §10.2, §14 Phase 2

## Summary

Specifies how organizations move existing work into Ordler: an admin wizard that reads
Linear (GraphQL API key) and Jira Cloud/Server/Data Center (REST API token with JQL) — token only, no file import —
maps teams, statuses, priorities, people, labels and hierarchy, runs a dry run, imports in a
resumable background job, and can be re-run without duplicates.

## Changes

- `docs/SPEC.md` — new §10.2 with sources, wizard steps, field mapping, identifiers and
  aliases, idempotent re-runs, scope limits and acceptance criteria; Phase 2 roadmap and the
  admin data row point to it.

## Tests

- None (documentation only).

## Notes

Implementation will need an ADR for the background job table and the Jira ADF → Markdown
conversion.
