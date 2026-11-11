# ADR 0016 — Import from Trello

- Status: Accepted
- Date: 2026-11-12

## Context

Teams moving to Ordler from Trello asked for the same import as Linear and Jira (SPEC §10.2).
Trello has no workflow states, priorities or sub-tasks: a board holds lists, and cards move
between them. Its API authenticates with a Power-Up API key plus a user token, and it hides
member emails from other users.

## Decision

- **Same runner, a third adapter.** `TrelloSource` implements the ADR 0010 adapter interface;
  runs, leases, `external_refs` idempotency, dry run and the wizard are reused. No new
  dependency and no migration: `import_runs.source` is plain text.
- **Mapping.** Board → container (team key suggested from the board name), lists → statuses
  with the kind guessed from common names in en/ru/de/az, archived cards and cards in archived
  lists → one "Archived" status (canceled by default, mappable). Checklists become Markdown
  task lists, link attachments a list of links, uploads attachments. Creation time comes from
  the card's ObjectId.
- **Credentials.** The API key and token are sealed together (`key:token`) like other import
  tokens and sent only in the `Authorization: OAuth …` header, never in query strings, so they
  cannot reach proxy logs. Uploaded files are downloaded with them only from `trello.com` and
  `api.trello.com`.
- **Paging.** Trello has no stable cursor over a board's cards, so each page reads the board's
  card list, orders it by id (ids grow with time) and takes the 50 after the last imported id;
  comments are read only for cards whose badge says they have any.
- **People** are keyed by `@username` because emails are hidden; admins map them by hand.

## Consequences

- Each page re-reads the board's card list: fine for typical boards (hundreds to a few
  thousand cards), slower for very large ones. Rate limits are handled by the existing 429
  back-off.
- Card start dates, custom fields, stickers and covers are not imported; start dates are
  listed in the report.
