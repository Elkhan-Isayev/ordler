# Multi-department requests, AGPL distribution, PostgreSQL 18

- Date: 2026-10-14
- Area: docs
- Spec: §2, §6.3, §6.4, §12.1, §13, §14, §15, §16.3, §17

## Summary

Owner answers to the open questions: requests may target several departments, approvals
always require sign-in, the project is AGPL-3.0 open source distributed like Wiki.js
(GitHub, GHCR, Docker Hub), and PostgreSQL support starts at the newest major on RDS (18).
Follows [2026-10-14-miro-architecture-map](2026-10-14-miro-architecture-map.md).

## Changes

- `docs/SPEC.md` v0.3 — proposed namespace `ordlerhq` (GitHub `ordler` is taken), new §6.4 multi-department requests (request groups), sign-in-only
  approvals, `request_group` tables, MVP criteria 12–13, PostgreSQL 18+ support policy,
  new §17 licensing and distribution, removed license-key permission, new open questions.
- `docs/adr/0003-open-source-distribution.md` — new.
- `docs/adr/0001-tech-stack.md`, `docs/adr/0002-on-prem-single-tenant.md` — PostgreSQL 18+,
  Node.js active LTS, `uuidv7()` keys.
- `CLAUDE.md` — AGPL-compatible dependencies, public-repo hygiene.
- Miro board — feature map, roadmap, diagrams and open questions updated.

## Tests

None — documentation only.

## Notes

`LICENSE` file (AGPL-3.0 text) still to be added before the repository goes public.
