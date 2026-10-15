# Monorepo foundation

- Date: 2026-10-14
- Area: shared, api, web, infra
- Spec: §4, §5.3, §11.1, §12, §12.1, §16.2, §16.3, §16.4

## Summary

First implementation increment: pnpm + Turborepo monorepo with the shared RBAC core, a
NestJS/Fastify API skeleton (config, database schema, migrations under an advisory lock,
health checks, deny-by-default permission guard) and a React web shell with the Linear-style
sidebar in four languages. Follows
[2026-10-14-mcp-personal-tokens](2026-10-14-mcp-personal-tokens.md).

## Changes

- Root — `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, ESLint,
  Prettier, `.nvmrc` (Node 24), `LICENSE` (AGPL-3.0), CI workflow `.github/workflows/ci.yml`.
- `packages/shared` — permission catalog, system roles, scope-aware `can()` /
  `effectivePermissions()`, status categories, locale resolution, Zod schemas, issue
  identifiers.
- `apps/api` — env config with `DATABASE_URL` or `DB_*`, `*_FILE` secrets, RDS TLS modes;
  pg pool mapping with schema search path; Drizzle schema (instance settings, departments,
  teams, members, roles, assignments, audit log) and migration `0000_init`; migrations under a
  PostgreSQL advisory lock; `/healthz` and `/readyz`; global `PermissionGuard` with
  `@Public()` and `@RequirePermission()`.
- `apps/web` — Vite + React + Tailwind shell, sidebar (personal items, workspace,
  departments → teams), i18next with an in-house ICU format plugin, locales en/ru/de/az.

## Tests

- `packages/shared/src/*.test.ts` — scope coverage, permission union, role catalog rules,
  locale resolution, schemas (44 tests).
- `apps/api/src/**/*.test.ts` — config validation and redaction, pool mapping, advisory lock
  ordering and release, readiness, health endpoints and guard 401/403/201 paths (29 tests).
- `apps/web/src/**/*.test.tsx?` — locale key parity, ICU validity and plural coverage, ICU
  plugin, sidebar behaviour and translations, app shell (30 tests).

## Notes

- `i18next-icu` was dropped: its default import of `intl-messageformat` breaks under Node's
  CommonJS resolution; `apps/web/src/i18n/icu-format.ts` replaces it.
- Not yet verified against a real PostgreSQL 18 (Docker was not running): the migration and
  `uuidv7()` defaults need an integration test with Testcontainers in the next increment.
- Authentication is not implemented, so the API's access context grants nothing yet.
- Dockerfile, Compose and Helm chart are still to do.
