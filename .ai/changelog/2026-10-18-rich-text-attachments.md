# Rich text descriptions with attachments in PostgreSQL

- Date: 2026-10-18
- Area: api, web, shared, docs
- Spec: §5.1, §16.2; ADR 0008

## Summary

Issue descriptions use a Linear-style editor: formatting, pasted or dropped screenshots and
files, and Mermaid diagrams. Files are stored in PostgreSQL, so restarted containers and
rescheduled pods lose nothing and one database backup covers all content.

## Changes

- `apps/api/drizzle/0006_attachments.sql` — `attachments` (metadata) and
  `attachment_contents` (`bytea`), additive.
- `apps/api/src/attachments/` — upload (`POST /api/teams/:key/attachments`, multipart, size
  limit) and download (`GET /api/attachments/:id/:name`) with team access checks, image type
  proven from the bytes, `nosniff`, sandboxing CSP, inline only for safe images, RFC 6266
  file names, immutable ETag caching.
- `apps/api/src/config/env.ts` — `ATTACHMENT_MAX_MB` (default 25).
- `apps/web/src/editor/` — `RichEditor` (Tiptap, Markdown storage, toolbar, paste/drop/attach
  uploads), Mermaid code blocks rendered lazily in strict mode, prose styles.
- `apps/web/src/issues/IssuePage.tsx`, `NewIssueDialog.tsx` — use the editor.
- i18n for en, ru, de, az.

## Tests

- `attachments/attachments.http.test.ts` — inline image with cache, disguised HTML and SVG as
  downloads, size limit, missing file, viewer can download but not upload, hidden teams,
  session required, helpers.
- `editor/RichEditor.test.tsx` — Markdown rendering, commit with images, no-op blur, image
  and file uploads, upload errors, diagram insert and read-only diagrams, syntax errors.
- Verified live: screenshot and diagram in a description, server restarted, the file served
  again from PostgreSQL; Markdown round-trips unchanged.

## Notes

New dependencies (MIT): `@fastify/multipart`, Tiptap 3.31.4 packages, `mermaid` 12.1.0.
Unreferenced uploads are kept; a cleanup job comes later.
