# ADR 0007 — Realtime updates

- Status: Accepted
- Date: 2026-10-18

## Context

Boards and issues must show other people's changes within a second (SPEC §5.4, §11). Ordler
runs several stateless replicas behind a load balancer and must not require infrastructure
beyond PostgreSQL (ADR 0002).

## Decision

- **Transport**: one WebSocket per tab at `/api/realtime` (`@fastify/websocket`, MIT, on the
  existing Fastify server). The session cookie authenticates the upgrade; the `Origin` header
  must match `BASE_URL`, which blocks cross-site WebSocket hijacking.
- **Topics**: a tab subscribes to `team:<id>`. The server checks read access (permission plus
  private-team visibility) on subscribe and again on delivery, cached for 30 s, so revoked
  access stops updates quickly.
- **Fan-out between replicas**: PostgreSQL `LISTEN/NOTIFY` on channel `ordler_events`. Writes
  publish `{type, teamId, issueId}` after commit; every replica loads the current issue and
  pushes it to its own subscribers. Payloads carry ids only.
- **Consistency**: the server always sends the full current issue, so the last write wins and
  every tab converges. Tabs refetch after reconnecting instead of replaying missed events.
- **Liveness**: the server pings every 30 s, drops sockets that do not answer and closes
  sockets whose session ended (code 4401).

## Consequences

- Load balancers must allow WebSocket upgrades; no sticky sessions are needed.
- A replica that loses its LISTEN connection reconnects; its tabs miss updates for a moment
  and catch up on their next refetch.
- Very large fan-outs (thousands of tabs per event) may later need batching; 1000 tabs is well
  within one Node process.
