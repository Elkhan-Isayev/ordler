# CLAUDE.md

Ordler is a task-management platform for work inside a department (Linear-like) and between
departments (Jira Service Management-like requests with cross-department approvals).

- Product requirements, domain glossary, RBAC model, data model: read `docs/SPEC.md` before
  any feature work; use its glossary terms (Department, Team, Issue, Request, Approval step,
  Approver selector…) in code, tests and UI copy.
- Architecture decisions: `docs/adr/` (0001 stack, 0002 on-prem single-tenant, 0003 AGPL
  and distribution, 0004 authentication, 0005 updates, 0006 installer and data volume, 0007 realtime, 0008 attachments and rich text). Record any deviation or new major dependency as a new ADR.
- The repository is public and AGPL-3.0: add only AGPL-compatible dependencies, and keep
  fixtures, tests and docs free of secrets and real company data.
- Ordler ships on-premises only: one Docker image, Compose and Helm chart, PostgreSQL 18+
  (often an existing RDS) as the only required service. Prefer PostgreSQL-based solutions
  over adding new infrastructure; deployment details are in `docs/SPEC.md` §16.

## Language

- Chat with the user: Russian.
- Everything in the repository is English: code, identifiers, comments, commit messages,
  docs, changelog entries.
- User-facing text goes through i18n keys. Every new key is added to all four locales —
  `en` (source), `ru`, `de`, `az` — in the same change, with real translations.

## Tests are part of every change

Every change to UI or server code ships with unit tests in the same change:

- New behaviour → tests that describe it. Changed behaviour → updated tests.
- Bug fix → first a failing regression test, then the fix.
- Web: Vitest + Testing Library, test files next to the component (`*.test.tsx`).
- API/worker/shared: Vitest, `*.test.ts` next to the module. Database code is tested on real
  PostgreSQL 18 through PGlite (`apps/api/src/test/pglite.ts`, no Docker needed); network/TLS
  integration tests via Testcontainers go in `*.int.test.ts`.
- Permissions, approvals, SLA and workflow transitions need tests for both the allowed and
  the denied path.
- Done = the full test suite and type-check pass locally; report the actual result.

## Commands

Scripts live in the root and package `package.json` files; run them with pnpm from Corepack.
Turbo needs a `pnpm` binary on `PATH`, so use `corepack enable` (or a shim) rather than
`corepack pnpm` when running root scripts. Tests import `@ordler/shared` from source via a
Vitest alias; runtime code imports its built `dist`.

## Changelog

Every change set adds a new file to `.ai/changelog/` following `.ai/README.md`
(one file per change, from `_TEMPLATE.md`).

## Invariants

- Authorization happens on the server for every read and write, through the permission
  catalog in `packages/shared` (permission constants, never ad-hoc role-name checks).
  The UI only mirrors it to hide controls.
- Schema migrations are forward-only, additive (expand/contract) and safe when several
  replicas start at once; a destructive statement needs `-- ordler:allow-destructive <reason>`
  and a major release (SPEC §16.5). Upgrades must never lose data.
- Personal tokens and MCP tools act exactly as their member: same domain services, RBAC
  and visibility as the UI; approvals are decided only by a signed-in human.
- Approval decisions and audit log rows are append-only.
- Secrets (OAuth client secrets, SMTP passwords, API keys) are encrypted at rest,
  write-only through the API, and redacted in logs and audit entries.
- Requester-facing APIs return only public comments and requester-visible fields.

## Conventions

- TypeScript `strict`; validate external input with Zod schemas from `packages/shared`.
- Conventional Commits (`feat(api): …`, `fix(web): …`, `test: …`, `docs: …`).
- Comments explain _why_, one line where possible.
