# ADR 0010 — Import from Linear and Jira

- Status: Accepted
- Date: 2026-10-24

## Context

SPEC §10.2 asks for an admin wizard that moves issues from Linear and Jira (Cloud, Server,
Data Center) into Ordler by API token, survives restarts, can be re-run without duplicates
and never notifies anyone while it runs. Ordler has no job queue and must keep PostgreSQL as
its only dependency (ADR 0002).

## Decision

- **Runs are rows.** `import_runs` holds the source, the encrypted token, the chosen scope and
  mapping, a resumable cursor, counters and a capped report. A runner on worker replicas
  (the same `role` split as update checks and cycle planning) claims a `running` run with a
  short lease (`lease_until`, set by one conditional `UPDATE`), processes one page (50 issues),
  saves the cursor and releases the lease. A lease works through a connection pool, unlike a
  session advisory lock; a crashed worker's lease runs out and another replica continues.
- **Idempotency through `external_refs`** `(source, kind, external_id) → ordler_id`, with the
  source's `updated_at`. A re-run updates items that changed, adds new issues and comments,
  and skips the rest. Issues keep the source key in `issues.external_key`, so search and
  `/issue/ENG-123` find them.
- **Adapters behind one interface** (`account`, `containers`, `people`, `page`, `download`):
  Linear GraphQL with a personal API key; Jira REST v3 (Cloud, email + API token, enhanced
  `search/jql` with `nextPageToken`) or v2 (Server/DC, personal access token, `startAt`).
  `fetch` is injected, so adapters are tested against recorded responses.
- **Text conversion without new dependencies**: a small Atlassian Document Format → Markdown
  converter and a wiki-markup → Markdown converter for the subset Jira actually produces
  (headings, marks, lists, code, quotes, tables, links, mentions, media). Unknown nodes keep
  their text.
- **Writes bypass notifications**: the importer inserts issues, comments, labels and
  attachments directly (numbering through the same team counter), so no Inbox, email or
  Slack message is sent; boards refresh through one `team.changed` event per team.
- **Security**: only `org.manage` may import; tokens are sealed with the instance key, never
  returned, and erased when a run completes or is canceled. Jira base URLs must be `https`;
  private addresses are allowed because Server/DC is usually internal.

## Consequences

- Field history is not replayed; each issue gets one "Imported from …" entry (SPEC §10.2).
- Estimates, sprints and relations other than parent/sub-issue are listed in the report as
  not imported until Ordler models them.
- Throughput is bounded by the source APIs; the runner backs off on HTTP 429.
