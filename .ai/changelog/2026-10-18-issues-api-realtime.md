# Team issues API and realtime updates

- Date: 2026-10-18
- Area: api, shared, docs
- Spec: §5.1, §5.2, §5.4; ADR 0007

## Summary

Teams get a default workflow and issues with per-team identifiers, priority, assignee, due
date, board ordering and an append-only history. Open tabs receive changes over a WebSocket
within a second, across replicas through PostgreSQL LISTEN/NOTIFY.

## Changes

- `packages/shared/src/issues.ts` — schemas, views, default statuses, realtime messages.
- `apps/api/drizzle/0005_issues.sql` — `workflows`, `workflow_statuses`, `issues`,
  `issue_events`, `teams.issue_counter` (additive).
- `apps/api/src/issues/` — workflows (created with each team, backfilled on start), team
  access (permissions plus private teams), issue service and controller:
  `GET /api/teams/:key`, `GET|POST /api/teams/:key/issues`, `GET|PATCH /api/issues/:identifier`,
  `GET /api/me/issues`.
- `apps/api/src/realtime/` — event bus (local and PostgreSQL LISTEN/NOTIFY) and the
  `/api/realtime` WebSocket hub with origin and session checks, heartbeats and per-delivery
  access checks.

## Tests

- `issues/issues.http.test.ts` — numbering, default status, history, validation, Member /
  Viewer / no-role / private-team access (allowed and denied).
- `realtime/realtime.http.test.ts` — real TCP sockets: updates delivered, denied topics,
  401/403 on upgrade, close on sign-out and malformed messages.

## Notes

New dependencies `@fastify/websocket` 11.3.1 (MIT) and dev `ws`, `@types/ws`. The web UI comes
in the next change.
