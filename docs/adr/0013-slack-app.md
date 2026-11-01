# ADR 0013 — Slack app without the Slack SDK

- Status: Accepted
- Date: 2026-11-01

## Context

SPEC §7.1 level 2 asks for an Ordler Slack app: personal DMs, a channel picker, link unfurls
and "create from message", connected through Socket Mode by default so on-premises installs
need no public URL. Every company creates its own Slack app, so Ordler ships a manifest, not a
Marketplace listing.

## Decision

- **No Slack SDK.** Ordler uses a small Web API client over `fetch` (JSON, `Retry-After` on 429) and a Socket Mode client over Node's built-in `WebSocket` (acknowledge each envelope
  after handling, reconnect with backoff, follow Slack's `disconnect` hint). `@slack/bolt` and
  its dependencies would add far more than these few hundred lines, and both protocols are
  small and stable.
- **One connection per worker.** Worker replicas each open a socket; Slack delivers every
  envelope to exactly one of them. HTTPS mode is the alternative, with v0 request signatures
  checked against the raw body and a five-minute replay window.
- **Linking is Sign in with Slack** (OpenID Connect, `openid` scope, `team` pinned to the
  connected workspace). The ID token is verified against Slack's JWKS, nonce and audience;
  a user of another workspace is refused. One Slack user maps to one member.
- **Slack acts as the linked member.** Unfurls, "create issue/request from message" and
  DMs go through the same services and permission checks as the UI. Unlinked Slack users get
  nothing but a hint to link; approvals are never decided from Slack.
- **Channels**: only public channels, picked from `conversations.list`; private channels are
  refused because their membership is outside Ordler's knowledge. Webhook subscriptions
  (level 1) keep working next to app channels.
- **Secrets** (bot token, app-level token, signing secret, client secret) are sealed together
  in `slack_app`, write-only and audited by name only.

## Consequences

- DMs mirror every Inbox event for members who keep them on; per-event preferences can refine
  this later without changing the link model.
- A member who leaves Slack keeps a dead link until they unlink or are deactivated; DMs to it
  fail quietly.
