# ADR 0009 — Personal access tokens and the built-in MCP server

- Status: Accepted
- Date: 2026-10-21

## Context

SPEC §10.1 asks for a built-in MCP server so AI agents (Claude, Cursor and other MCP clients)
work in Ordler as a member, authenticated with self-service personal access tokens. Agents
must never get more power than their member, and approvals stay human decisions.

## Decision

- **Tokens**: `ordl_pat_<random>`; only the SHA-256 is stored, with a visible prefix,
  scopes (`read`, `issues:write`, `requests:write`), expiry (default 90 days, admin maximum,
  "no expiry" only when allowed), last use time and IP. Members revoke their own; org admins
  list and revoke any. Creating one needs `token.create_personal` held at any scope.
- **Where tokens work**: only on `POST /mcp` in the MVP. The REST API ignores
  `Authorization: Bearer`, so tokens cannot reach admin endpoints or decide approvals even by
  accident; the public REST API with tokens is Phase 2.
- **Transport**: MCP Streamable HTTP in stateless JSON mode — every POST carries one
  JSON-RPC message or a batch and gets `application/json` back; notifications answer 202;
  GET/DELETE answer 405 (no server streams, no sessions). This keeps the endpoint
  replica-agnostic behind any load balancer, like the rest of Ordler.
- **No runtime MCP dependency**: the protocol surface we need (initialize, ping, tools,
  resources) is small, so it is implemented directly on Fastify with Zod schemas
  (`z.toJSONSchema` for tool input schemas). The official MCP TypeScript SDK (MIT) is a dev
  dependency only, used by a test that connects a real client.
- **Same rules as the UI**: every tool calls the same domain services with the member id, so
  RBAC, private-team visibility and validation are identical. Scopes only narrow what a token
  may do. `mcp.use` (any scope) and the admin MCP switch are checked on every call; each
  token is limited to 120 requests per minute.
- **Accountability**: agent writes record the token name in issue history (`via_token`) and
  write audit rows with actor type `token`; request events and audits carry `via`.
- **Origin**: requests with a foreign `Origin` header are refused (DNS rebinding); cookies
  are never accepted on `/mcp`.

## Consequences

- MCP clients that only speak the older HTTP+SSE transport are not supported.
- OAuth 2.1 for MCP clients (no token copy-paste) remains Phase 2 (SPEC §10.1).
