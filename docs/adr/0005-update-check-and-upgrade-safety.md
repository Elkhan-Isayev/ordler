# ADR 0005 — Update check and upgrade safety

- Status: Accepted
- Date: 2026-10-15

## Context

Ordler is self-hosted. Admins need to learn about new releases without watching GitHub, and
an upgrade must never lose data: the database is often an existing RDS instance holding the
company's work.

## Decision

- **Release check**: anonymous daily request to the GitHub releases API of a configurable
  repository, with ETag caching; stable SemVer releases only; result stored in
  `update_status` and shown to members with `org.manage`. `UPDATE_CHECK=false` turns it off.
- **No self-updating container**: the app shows upgrade instructions. One-click upgrades via an
  opt-in companion with Docker/Kubernetes access are deferred to Phase 2, because that access
  is equivalent to root on the host.
- **Migration rules**: one transaction for all pending migrations; additive expand/contract
  changes; destructive statements blocked by a lint test unless explicitly marked with a
  reason; data-preservation tests across every migration; refuse to start on a newer schema
  or (with `ORDLER_MIGRATE=false`) with pending migrations.

## Consequences

- Removing a column takes at least two releases (stop using it, then drop it in a major).
- A broken migration costs an aborted start, never a half-migrated database.
- Downgrades require restoring the pre-upgrade snapshot, so the upgrade instructions always
  start with taking one.
