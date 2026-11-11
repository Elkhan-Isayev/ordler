# ADR 0015 — Whiteboards

- Status: Accepted
- Date: 2026-11-11

## Context

Teams want Miro-style whiteboards inside Ordler (SPEC §5.5): several people drawing on one
canvas at once, boards attached to issues and shown inside them, and AI agents creating
diagrams through MCP. Ordler is AGPL, on-prem and must not need infrastructure beyond
PostgreSQL (ADR 0002, 0003).

## Decision

- **Editor**: Excalidraw (`@excalidraw/excalidraw`, MIT). It covers shapes, bound arrows,
  text, freehand, images, frames, libraries, laser pointer, export and collaborator cursors,
  and it ships reconciliation primitives for multiplayer use. tldraw was rejected: its license
  requires a commercial key for production use and is not AGPL-compatible. The editor is
  lazy-loaded; its fonts are copied into the web build and served by Ordler
  (`/excalidraw-assets/fonts`), so no CDN is contacted.
- **Storage**: one PostgreSQL row per element (`whiteboard_elements`, the element JSON in
  `data`), deleted elements kept as tombstones so every tab converges. Images live in
  `whiteboard_files` as `bytea`, like attachments (ADR 0008).
- **Convergence**: per element, the higher `version` wins and equal versions go to the lower
  `version_nonce` — the editor's own rule — enforced by the upsert's `WHERE` clause. No CRDT
  library is needed: elements are independent, ordering uses their fractional `index`.
- **Change numbers**: each save bumps `whiteboards.seq` under the board's row lock and stamps
  the rows it wrote. Saves therefore commit in sequence order, and a tab catches up with
  `GET /scene?since=<seq>` after reconnecting without ever skipping a change.
- **Transport**: edits are saved with `POST /api/whiteboards/:id/scene` (batched about every
  80 ms, up to 16 MB per body). The existing realtime socket (ADR 0007) gets a
  `whiteboard:<id>` topic; `LISTEN/NOTIFY` carries only `{whiteboardId, seq}` and each replica
  loads the elements once per event. Pointers and selections are ephemeral: sent over the
  socket, fanned out through NOTIFY (a few KB at most), never stored, limited to 30 per second
  per tab.
- **Access**: a board belongs to a team; reading follows team visibility, drawing needs the
  new `whiteboard.edit` permission (every role with `issue.create`), attaching to an issue
  needs `issue.update` there.
- **MCP**: agents describe diagrams as nodes and edges; the server lays them out (layered,
  top-down or left-right) and produces editor elements. Agents never write raw editor JSON.

## Consequences

- Element edits are not audited row by row (an editor saves many times a second); creation,
  renaming, deletion, attaching and agents' content changes are.
- Deleted elements stay in the database; a board is capped at 20 000 element rows.
- A board's content is kept when it is deleted (archived); a later version may add restore and
  version history.
- The web image grows by about 13 MB of fonts (mostly CJK) so boards render offline.
