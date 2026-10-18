# Issue comments

- Date: 2026-10-18
- Area: api, web, shared
- Spec: §5.1 (Activity), §12.1 (`comment`)

## Summary

Issues get comments in the same rich editor as descriptions, with screenshots, files and
diagrams. Comments and field history appear in one chronological activity stream and update
live in every open tab.

## Changes

- `apps/api/drizzle/0007_comments.sql` — `comments` with subject, author, Markdown body,
  visibility (for requests later) and soft deletion; additive.
- `apps/api/src/issues/issue.service.ts`, `issues.controller.ts` —
  `POST /api/issues/:identifier/comments`, `PATCH|DELETE /api/comments/:id`; comment.create to
  write, only the author edits, author or comment.delete_any deletes; every change is
  published on the realtime channel.
- `packages/shared/src/issues.ts` — `CommentView`, `commentBodySchema`, `can.comment`.
- `apps/web/src/issues/Comments.tsx`, `IssuePage.tsx` — activity timeline, comment cards with
  edit and delete, composer with Ctrl/Cmd+Enter; i18n for en, ru, de, az.

## Tests

- `issues/issues.http.test.ts` — add/edit/delete with events, nobody edits others' comments,
  delete permissions, viewers and strangers denied, validation.
- `issues/Comments.test.tsx` — timeline order, rich rendering, sending, deleting, hidden
  actions.

## Notes

None.
