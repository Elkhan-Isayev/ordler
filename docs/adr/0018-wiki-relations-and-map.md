# ADR 0018 — Wiki relations, the wiki map and company context over MCP

- Status: Accepted
- Date: 2026-11-20

## Context

Department wikis (ADR 0017) hold the company's knowledge, but pages only know their folder.
People asked to relate pages to each other (and to the issues, requests and boards they are
about), to see the whole wiki as a graph like Obsidian's graph view, and to let AI clients pull
the context of a topic in one call, the way Graphify turns a corpus into a graph for agents.

## Decision

- **Two sources of relations.** Typed relations are stored in `wiki_relations` (page →
  page, issue, request or whiteboard; types `related`, `part_of`, `depends_on`, `supersedes`,
  `references`; optional note). Links written in page text — `[[Page title]]`,
  `/wiki/page/<id>`, `/issue/HELP-12`, `/requests/REQ-3`, `/whiteboards/<id>` — count as
  `references` and are read from the text, not stored, so they can never go stale and existing
  pages (imported ones included) take part without a backfill.
- **One link pattern** (`WIKI_LINK_PATTERN` in `packages/shared`) is written so PostgreSQL and
  JavaScript read it alike: the map extracts links with `regexp_matches` inside the database
  (no page text leaves PostgreSQL), single pages and the browser use the same pattern.
- **`[[Title]]`** names the page of that title in the same space first, then in any readable
  space; the reader view turns it into a link when the reader may open the page.
- **Access**: no new permissions. Reading relations and the map needs `wiki.read`; adding and
  removing a relation needs `wiki.edit` on its source page. Every node passes its own module's
  check: pages by wiki access, issues by team access, requests by request visibility, boards by
  team access. Hidden targets are dropped, and adding one is refused like a typo. Additions and
  removals are audited (`wiki.relation_added`, `wiki.relation_removed`).
- **The map** (`GET /api/wiki/graph`, Workspace → Wiki → Map) has departments and folders as
  cluster nodes (`in` edges) and pages, issues, requests and boards as nodes; one department
  narrows it. At most 300 linked issues, requests and boards are checked per map; the rest is
  reported as truncated. It is laid out in the browser with `d3-force` (ISC, already in the
  dependency tree through Mermaid) and, like every diagram, always drawn on light.
- **MCP**: `list_wiki_relations`, `get_wiki_graph`, `get_wiki_context` (read);
  `add_wiki_relation`, `remove_wiki_relation` (`wiki:write`); `create_wiki_page` and
  `update_wiki_page` take `relations`; `get_wiki_page` returns them. `get_wiki_context` starts
  from an issue or request (the pages with a relation or a link to it), given pages, or search
  hits; walks relations breadth first up to three hops; and returns the nearest pages with their
  text within a character budget plus the linked items. `get_issue` and `get_request` list the
  `wikiPages` about the task, and the server's `instructions` tell agents to read that context
  before a task and to write what they learn back with relations. Ordler runs no LLM: relation
  extraction is done by the AI client, which writes typed relations back.
- **Agent search** (`search_wiki`, `get_wiki_context` with `query`): pages with the exact phrase
  first, then PostgreSQL full-text search for any of the words (prefixes too), ranked with
  title words above body words. It uses the `simple` configuration, so every UI language works
  without stemming, and a short list of function words in en/ru/de/az is dropped. A GIN
  expression index (`wiki_pages_search_idx`, migration 0034) backs it; no embeddings and no new
  service. The UI search keeps the exact-phrase behaviour.
- **Visibility in batches**: the map and the context check linked issues and requests with one
  query per kind (the same rules as one by one), not one lookup each.

## Consequences

- A rename of a page changes which page `[[Old title]]` names; links by id are stable.
- Large maps check linked items in batches; the cap of 300 keeps the response bounded.
- Search matches words, not meaning: a question with none of a page's words misses it. Semantic
  search would need embeddings, i.e. a model and a vector store, which this ADR leaves out.
- Typed relations to a page that is later archived disappear from views but stay in the table.
