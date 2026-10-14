# ADR 0001 — Tech stack

- Status: Accepted
- Date: 2026-10-14

## Context

Ordler needs a fast, keyboard-first SPA (Linear-class UX), a backend with strict server-side
RBAC, background jobs (notifications, SLA timers, approval timeouts, webhooks) and real-time
sync. The team is small, so one language across the stack and shared types between client
and server matter more than raw throughput. Ordler is distributed on-premises only
(see ADR 0002), so every extra runtime dependency is a cost for the operator.

## Decision

- TypeScript everywhere, `strict` mode; Node.js active LTS in the runtime image.
- Monorepo: pnpm workspaces + Turborepo (`apps/web`, `apps/api`, `apps/worker`,
  `packages/shared`, `packages/ui`).
- Web: React, Vite, TanStack Router, TanStack Query, Tailwind CSS, Radix UI primitives.
- i18n: i18next with ICU MessageFormat; locales `en` (source), `ru`, `de`, `az`.
- API: NestJS (modules map to domains: auth, org, rbac, issues, requests, approvals, sla,
  notifications, audit, mail, setup), REST + OpenAPI, WebSocket gateway.
- Validation: Zod schemas in `packages/shared`, used on both client and server.
- Database: PostgreSQL 18+ (newest major GA on AWS RDS); Drizzle ORM + SQL migrations;
  primary keys are `uuidv7()`.
- Jobs: pg-boss (PostgreSQL-backed queue). Real-time fan-out between replicas via
  PostgreSQL `LISTEN/NOTIFY`. Redis is optional, cache only.
- Storage: local volume or S3-compatible object storage.
- Mail: Nodemailer, SMTP configured in the admin panel or env.
- MCP: official TypeScript SDK `@modelcontextprotocol/sdk` (MIT), Streamable HTTP transport
  mounted in the API; tools call the same domain services as REST controllers.
- Tests: Vitest (unit, both apps), Testing Library (React), Testcontainers (API integration),
  Playwright (E2E).

## Consequences

- Shared Zod schemas and the permission catalog keep UI and API in sync at compile time.
- NestJS adds boilerplate but gives clear module boundaries and DI that make unit testing
  of domain services straightforward.
- PostgreSQL as the single required service keeps installs as simple as Wiki.js; pg-boss and
  `LISTEN/NOTIFY` are enough for the target scale (10k members). Revisit with a new ADR if
  queue throughput becomes a bottleneck.
- PostgreSQL full-text search is enough for v1; a dedicated search engine is a later ADR.
