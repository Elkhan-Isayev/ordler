# MCP server and personal access tokens

- Date: 2026-10-14
- Area: docs
- Spec: §4.3, §4.4, §8, §10.1, §12.1, §14

## Summary

Built-in MCP server so AI agents can work in Ordler on behalf of a member, authenticated
with self-service personal access tokens (Wiki.js-style API access, but every member creates
their own). Agents act with the member's permissions and cannot decide approvals.
Follows [2026-10-14-slack-notifications](2026-10-14-slack-notifications.md).

## Changes

- `docs/SPEC.md` v0.5 — new §10.1 (tokens, scopes, `/mcp` endpoint, tool list, resources,
  audit, rate limits), permissions `token.create_personal` and `mcp.use`, admin section
  "API, tokens & MCP", `personal_access_token` table, MVP scope and acceptance criterion 15.
- `docs/adr/0001-tech-stack.md` — MCP TypeScript SDK.
- `CLAUDE.md` — invariant: tokens and MCP act exactly as their member.
- Miro board — feature map, admin panel, architecture diagram and roadmap updated.

## Tests

None — documentation only.

## Notes

OAuth 2.1 for MCP clients is planned for Phase 2.
