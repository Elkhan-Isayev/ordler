# Import from Trello

- Date: 2026-11-12
- Area: api | web | shared | docs
- Spec: §10.2

## Summary

Admin → Import can now bring Trello boards over, next to Linear and Jira: boards become teams,
lists statuses, cards issues with comments, checklists, labels, members and uploaded files.

## Changes

- `packages/shared/src/imports.ts` — `trello` source; connect schema with API key and token.
- `apps/api/src/imports/sources/trello.ts` — Trello REST adapter (OAuth header, id-ordered
  paging, list-kind guessing, checklists, attachments restricted to Trello hosts).
- `apps/api/src/imports/sources/index.ts`, `import.service.ts` — wiring; key and token sealed together.
- `apps/api/src/db/schema.ts` — `trello` in the source enum (TypeScript only, no migration).
- `apps/web/src/admin/ImportSection.tsx` — Trello option with API key and token fields.
- Locales en/ru/de/az — Trello labels, hints and the start-date warning.
- Docs — ADR 0016, SPEC §10.2, README, CLAUDE.md.

## Tests

- `apps/api/src/imports/sources/trello.test.ts` — auth header, boards/lists, people, card
  conversion, paging, archived cards, download host check, refused token, helpers.
- `apps/api/src/imports/imports.http.test.ts` — Trello connect validates input and never returns the secret.
- `apps/web/src/admin/ImportSection.test.tsx` — Trello connect form.

## Notes

No migration.
