# ADR 0008 — Attachments in PostgreSQL and Markdown rich text

- Status: Accepted
- Date: 2026-10-18

## Context

Issue descriptions and comments need Linear-style rich text: formatting, pasted screenshots,
files and diagrams. Ordler runs as stateless containers; anything kept on the container file
system disappears on restart or reschedule, and companies should not need object storage
just to attach a screenshot (ADR 0002: PostgreSQL is the only required service).

## Decision

- **Storage**: attachments live in PostgreSQL — metadata in `attachments`, bytes in
  `attachment_contents` (`bytea`, TOAST-compressed), so listings never read file contents and
  one database backup covers everything. Default limit 25 MB per file (`ATTACHMENT_MAX_MB`).
  An S3-compatible driver can be added later behind the same service for very large volumes.
- **Access**: an attachment belongs to a team. Uploading needs write access to the team's
  issues, downloading needs read access; unreadable files answer 404.
- **Safe serving**: only images proven by their bytes (PNG, JPEG, GIF, WebP, AVIF) are shown
  inline; everything else, including SVG and HTML, is a download. Every response carries
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
  Responses are immutable and cached privately by their SHA-256 ETag.
- **Rich text**: Tiptap (MIT, ProseMirror) with Markdown as the stored format, so content stays
  readable in exports, the API and MCP. Images are Markdown images pointing at attachment URLs.
  Diagrams are ```mermaid code blocks rendered client-side by Mermaid (MIT) in `strict`
  security mode, loaded lazily.

## Consequences

- Database size grows with attachments; admins size RDS storage accordingly and the install
  guide says so. Orphaned uploads (attached but removed from the text) are kept for now; a
  cleanup job can delete unreferenced files later.
- The web bundle grows by the editor (~1 MB minified, ~300 KB gzipped); Mermaid is split into
  chunks loaded only when a diagram is shown.
