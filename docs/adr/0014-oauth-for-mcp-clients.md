# ADR 0014 — OAuth 2.1 for MCP clients

- Status: Accepted
- Date: 2026-11-01
- Extends: ADR 0009

## Context

SPEC §10.1 asks that MCP clients which support it connect without copying a personal token.
The MCP authorization specification builds on OAuth 2.1: protected resource metadata
(RFC 9728), authorization server metadata (RFC 8414), dynamic client registration (RFC 7591),
PKCE and resource indicators (RFC 8707). Clients such as Claude and Cursor register
themselves, so Ordler cannot know them in advance.

## Decision

- **Ordler is its own authorization server.** Metadata at
  `/.well-known/oauth-protected-resource[/mcp]` and `/.well-known/oauth-authorization-server`;
  `/mcp` answers 401 with `resource_metadata` in `WWW-Authenticate`.
- **Open registration, public clients only.** Any client may register (rate limited per IP);
  redirect URIs must be HTTPS, loopback HTTP (any port, RFC 8252) or a native app scheme, never
  `javascript:`/`data:`/`file:` or fragments. Trust comes from the member's consent, which
  names the client and where the answer goes.
- **Consent in the web app** at `/oauth/authorize`: sign-in first if needed, then the member
  sees the client, the redirect host and the scopes, may narrow the scopes, and allows or
  denies. Granting needs `mcp.use`, `token.create_personal` and the MCP switch, like creating
  a token by hand.
- **Codes**: single use, five minutes, bound to client, redirect URI and an S256 PKCE
  challenge; a replayed code revokes the grant it produced.
- **Grants are personal tokens.** A grant is a `personal_tokens` row marked with its client:
  the access token (`ordl_oat_…`, one hour) is the row's token hash, and a rotating refresh
  token (`ordl_ort_…`) lives next to it, valid for at most 90 days or the admin's token
  maximum. Listing, revoking (own or by admins), last use, audit and the MCP checks therefore
  work unchanged, and revoking also stops refreshing.
- **No cookies on token and registration endpoints**, so they allow any origin (CORS) and are
  exempt from the Origin check; `/mcp` keeps refusing foreign origins.

## Consequences

- A member who signs in with Google during consent comes back to the start page and has to
  start the connection again; password and email-code sign-in keep the page.
- Refresh-token reuse is refused but not detected as theft; rotation still limits a leaked
  token to one use.
