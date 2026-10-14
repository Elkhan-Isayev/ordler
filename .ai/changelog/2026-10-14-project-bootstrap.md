# Project bootstrap

- Date: 2026-10-14
- Area: docs
- Spec: all

## Summary

Initial repository setup: technical specification, agent instructions, changelog convention
and proposed tech stack for Ordler, a task-management platform for work inside and between
departments.

## Changes

- `docs/SPEC.md` — technical specification v0.1: org structure (organization → departments →
  teams), RBAC, Linear-like internal work, JSM-like cross-department requests, approval
  chains, SLA, admin panel incl. authentication strategies and SMTP settings, NFRs, phases.
- `docs/adr/0001-tech-stack.md` — proposed stack (TypeScript monorepo, React, NestJS, PostgreSQL).
- `CLAUDE.md` — agent rules: language, mandatory unit tests, changelog, security invariants.
- `.ai/README.md`, `.ai/changelog/_TEMPLATE.md` — changelog convention.
- `README.md`, `.gitignore`, `.editorconfig`, `.github/pull_request_template.md`.

## Tests

None — documentation only, no code yet.

## Notes

Tech stack is "Proposed" until confirmed by the project owner. Open questions are listed in
`docs/SPEC.md` §15.
