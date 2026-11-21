# ADR 0019 — GitHub integration through a GitHub App

- Status: Accepted
- Date: 2026-11-21

## Context

SPEC §10 lists "Git provider links (branch/PR mention → issue)". Teams want what Linear offers:
branches, pull requests and commits that mention an issue identifier show up on the issue, a
"Copy branch name" button, a bot comment on new pull requests that links back to Ordler, and
optional status changes when a pull request opens or merges. Ordler is on-premises (ADR 0002):
many companies run GitHub Enterprise Server inside the same network, others use github.com.

Two ways to connect were considered:

- **Repository webhooks plus a personal access token.** Simple to explain, but every repository
  needs its own webhook, the token belongs to a person (comments appear as them and stop when
  they leave), and classic tokens grant far more than Ordler needs.
- **A GitHub App** owned by the company's GitHub organization. One webhook for every repository
  the app is installed on, fine-grained permissions, comments from a bot identity, short-lived
  installation tokens. GitHub's manifest flow creates the app in two clicks, much like the Slack
  app manifest (ADR 0013).

## Decision

- **A GitHub App created from a manifest.** Admin → Integrations → GitHub shows the GitHub URL
  (`https://github.com` or a GitHub Enterprise Server URL; the API is `api.github.com` or
  `<url>/api/v3`) and an optional organization. "Create GitHub App" posts Ordler's manifest to
  GitHub; GitHub redirects back with a one-time code that Ordler converts
  (`POST /app-manifests/{code}/conversions`) into the app id, slug, private key and webhook
  secret. A signed, short-lived state cookie ties the redirect to the admin who started it.
  Admins who cannot use the redirect paste the app id, private key and webhook secret instead.
  The admin then installs the app on the repositories it should watch, on GitHub.
- **Permissions requested**: metadata (read), contents (read: branches and commits), pull
  requests (read and write: the bot comment lives on the pull request conversation). Events:
  `create`, `delete`, `push`, `pull_request`.
- **No GitHub SDK.** A small client over `fetch` signs a ten-minute app JWT (RS256, `jose`, which
  Ordler already uses) and exchanges it for an installation token per installation, cached until
  shortly before it expires. The few REST calls Ordler makes do not justify Octokit.
- **Webhook receiver** at `POST /api/github/webhook`, with its own raw-body parser.
  `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the webhook secret) is checked in
  constant time before anything is parsed; unsigned or wrongly signed deliveries get 401.
  `X-GitHub-Delivery` ids are remembered for a day so redeliveries are handled once. GitHub
  must be able to reach this one path; behind a firewall it is the only route to expose.
- **Linking.** An identifier (`ENG-12`) in a branch name (`elkhan/eng-12-fix-login`, any case),
  pull request title or body, or commit message links that item to the issue. Only keys of
  existing teams count, at most 20 issues per item, so text such as `UTF-8` is ignored unless a
  team `UTF` exists. Links are rows in `github_links` (kind, repository, branch name / pull
  request number / commit SHA, title, state, URL, author login); pull requests are `open`,
  `draft`, `merged` or `closed`, branches are removed when GitHub deletes them. Links are
  facts reported by GitHub, written by the system, and read through the issue's own read
  permission: whoever may read the issue sees its links.
- **Bot comment.** When a pull request first links issues, the app comments once with each
  issue's identifier, title, status and link, and edits that comment when the set of linked
  issues changes (one row per pull request in `github_pull_request_comments`, claimed with an
  insert so two replicas never both comment). Issues of private teams appear as identifier and
  link only, because people who can read the repository need not be Ordler members.
- **Workflow automation per team**, off by default: a team lead (`team.update`) picks the status
  for "pull request opened" and for "pull request merged" in team settings. Opening moves only
  issues that are not yet started (backlog or unstarted) and not in Triage; merging moves only
  issues that are not completed or canceled. The change is recorded as a system change "via
  GitHub" in the issue history, with realtime updates, webhooks and notifications like any
  other status change.
- **Configuration** is organization-level, gated by `integration.manage` (already in the
  catalog; Owner and Organization Admin have it). The private key, webhook secret and client
  secret are sealed together with the instance key, write-only through the API, and audited by
  name only (`github_app.updated`, `github_app.created`). Team automation changes are audited
  as `team.github_updated`.

## Consequences

- github.com installs need inbound HTTPS to `/api/github/webhook`; GitHub Enterprise Server
  inside the network needs nothing special. A polling fallback can be added later without
  changing the link model.
- Links follow what GitHub reports from the moment the app is installed; older branches and
  pull requests are not back-filled.
- Identifiers of imported issues (their old keys, SPEC §10.2) are not matched; only current
  identifiers are.
- GitLab and Bitbucket can reuse `github_links`-style rows and the identifier matcher, but get
  their own ADR.
