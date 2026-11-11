# Whiteboards: collaborative canvases, attached to issues and drawable through MCP

- Date: 2026-11-11
- Area: api | web | shared | docs
- Spec: §5.5, §4.3, §10.1

## Summary

Adds Miro-style whiteboards built on Excalidraw: teams draw together live with cursors and
selections, attach boards to issues (shown live inside the issue) and let AI agents create
diagrams through MCP. Storage and fan-out use only PostgreSQL (ADR 0015).

## Changes

- packages/shared/src/whiteboards.ts — element, scene, file, presence schemas and types;
  `whiteboard.edit` permission for every role with `issue.create`; realtime messages.
- apps/api/drizzle/0030_whiteboards.sql — `whiteboards`, `whiteboard_elements`,
  `whiteboard_files`, `issue_whiteboards`.
- apps/api/src/whiteboards — WhiteboardService (access, version-wins upsert under a row lock,
  files, issue links, audit), controller, large-body routes, MCP diagram builder and reader.
- apps/api/src/realtime — `whiteboard:<id>` topic, element fan-out, rate-limited pointers.
- apps/api/src/mcp — `list_whiteboards`, `get_whiteboard`, `create_whiteboard`,
  `add_to_whiteboard`, `attach_whiteboard`; `ordler://whiteboard/{id}`; boards on `get_issue`.
- apps/api/src/issues — `TeamView.can.whiteboards`, `GET /api/teams` flags where boards can
  be created.
- apps/web/src/whiteboards — list page, full-screen board with templates, presence and
  rename/delete, live boards inside the issue page, sync logic; fonts served from Ordler.
- apps/web/src/settings/OutOfOfficePage.test.tsx — pins today's date: its fixed November
  dates had passed and the form refuses past dates.
- docs/adr/0015-whiteboards.md, docs/SPEC.md, README.md, CLAUDE.md.

## Tests

- apps/api/src/whiteboards/whiteboards.http.test.ts — permissions allowed and denied,
  convergence rule, catch-up with deletions, body limit, element cap, images, issue links.
- apps/api/src/whiteboards/diagram.test.ts — layout, bindings, ids, wrapping, reading back.
- apps/api/src/realtime/realtime.http.test.ts — element fan-out, pointers, leaving, denial.
- apps/api/src/mcp/mcp.http.test.ts — agent draws, attaches, reads; scopes; no orphan boards.
- packages/shared — schemas and the `whiteboard.edit` role rule.
- apps/web/src/whiteboards — sync tracker, saver, presence roster, templates, pages.

## Notes

Migration 0030 is additive. Comments on boards, version history and restore of deleted
boards are follow-ups.
