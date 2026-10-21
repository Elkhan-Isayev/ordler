# Personal access tokens and the built-in MCP server

- Date: 2026-10-21
- Area: api, web, shared, docs
- Spec: §10.1; MVP criterion 15

## Summary

Members create personal access tokens and connect MCP clients to `POST /mcp`; agents list,
create and update issues, comment, browse portals and submit requests as the member, with
the same permissions as the UI. Approvals stay read-only for agents, revoked or expired
tokens get 401, and agent writes show "via token" in history and the audit log.

## Changes

- `apps/api/drizzle/0011_personal_tokens_and_mcp.sql` — `personal_tokens`, MCP and expiry
  settings on `instance_settings`, `issue_events.via_token` (all additive).
- `apps/api/src/tokens/` — TokenService (hash-only storage, scopes, expiry limits, revoke,
  last use) and `/api/me/tokens`, `/api/admin/tokens` endpoints.
- `apps/api/src/mcp/` — Streamable HTTP JSON-RPC server (initialize, ping, tools,
  resources) and the SPEC tool set; origin, token, MCP switch, `mcp.use` and 120/min checks.
- `apps/api/src/issues/issue.service.ts` — optional `via` token name on create, update and
  comment: stored in history and audited with actor type `token`.
- `apps/api/src/requests/request.service.ts` — audit key `via` (the old `viaToken` key was
  redacted by the secret filter).
- Web: Settings → Access tokens (`/settings/tokens`, opened from the member name), Admin →
  Access tokens and MCP, "via token" in issue history; i18n en/ru/de/az.
- `docs/adr/0009-personal-tokens-and-mcp.md`; `@modelcontextprotocol/sdk` as an API dev
  dependency for the interop test.

## Tests

- `api/src/mcp/mcp.http.test.ts` — criterion 15 end to end, scopes, resources, batches,
  origin, MCP switch, rate limit, expiry, hash-only storage, admin limits, guests denied,
  admin revoke.
- `api/src/mcp/mcp-client.test.ts` — the official MCP SDK client connects and calls tools.
- `web/src/settings/TokensPage.test.tsx`, `web/src/admin/TokensSection.test.tsx`,
  `web/src/issues/IssuePage.test.tsx` — token UI, admin settings, "via token" history.

## Notes

The REST API does not accept tokens yet (Phase 2); `search` covers titles and identifiers of
issues in the member's teams and their own requests until full-text search lands.
