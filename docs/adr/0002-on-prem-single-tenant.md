# ADR 0002 — On-premises, single-tenant deployment

- Status: Accepted
- Date: 2026-10-14

## Context

Customers run Ordler inside their own infrastructure, on Docker or Kubernetes, the way
Wiki.js is deployed, and connect it to PostgreSQL they already operate (e.g. AWS RDS).
There is no hosted SaaS offering.

## Decision

- One installation serves exactly one organization. No `organization_id` columns,
  no tenant routing, no row-level security for tenant isolation.
- Distribution: one container image (role chosen by `ORDLER_ROLE`), a Docker Compose
  example and a Helm chart.
- PostgreSQL 18+ is the only mandatory external service; configuration via environment
  variables (with `*_FILE` variants for mounted secrets).
- Migrations run on startup under a PostgreSQL advisory lock; can be disabled for
  DBA-controlled rollouts.
- The app requires no PostgreSQL superuser; it works inside its own schema.
- First run shows a setup wizard (first Owner, company name, base URL, default language).

## Consequences

- Simpler data model and queries; authorization is purely RBAC (department/team scopes).
- A future SaaS offering would require a migration that adds tenant isolation; accepted risk.
- Upgrades are operator-driven, so schema migrations must be forward-only, idempotent and
  safe under concurrent replica start.
- The app must run without outbound internet access.
