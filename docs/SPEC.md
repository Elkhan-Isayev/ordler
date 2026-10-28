# Ordler — Technical Specification

| Field   | Value                               |
| ------- | ----------------------------------- |
| Product | Ordler (working name, `ordler.com`) |
| Version | 0.5 (draft)                         |
| Date    | 2026-10-14                          |
| Status  | Draft — open for review             |

---

## 1. Purpose and scope

Ordler is a work-management platform for organizations that need **two kinds of work in one tool**:

1. **Internal work inside a team** — planning, tracking and shipping tasks the way
   Linear does it (issues, cycles, projects, initiatives, views, keyboard-first UI).
2. **Cross-department requests** — one department asks another for something
   (Customer Support → IT, Sales → Legal, any → Finance) through a service portal
   with request forms, SLAs and **approval chains** the way Jira Service Management does it.

The key difference from both references: a cross-department request is a first-class
object that lives in the same system as internal work. The receiving team can triage it,
split it into internal issues, and the requester sees progress without seeing internals.

**Open source (AGPL-3.0), on-premises only.** Each company runs its own Ordler installation
(Docker or Kubernetes, like Wiki.js) connected to its own PostgreSQL (e.g. an existing
AWS RDS instance). One installation serves exactly one organization (§16). Source,
images and Helm chart are public, like Wiki.js (§17).

### 1.1 Goals

- One place for intra- and inter-department work; no context switching between tools.
- Configurable organization structure: **Organization → Departments → Teams**.
- Fine-grained **RBAC** managed from an admin panel.
- **Approvals** that can span departments (e.g. IT work that needs Finance sign-off).
- Fast, keyboard-first UI comparable to Linear.
- Full audit trail for permission, approval and workflow changes.

### 1.2 Non-goals (v1)

- Public external customer portal (anonymous customers). v1 portal is for authenticated
  members of the organization only.
- Time tracking, invoicing, HR features.
- Native mobile apps (responsive web only in v1).
- Code hosting / CI integration beyond webhooks.
- Hosted SaaS and multi-tenancy (several organizations in one installation).

---

## 2. Glossary

| Term                  | Definition                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization**      | The company that owns the installation. Exactly one per installation; its settings (name, URL, branding, default language) live in the admin panel.                                   |
| **Department**        | Business unit inside an organization (IT, Finance, Customer Support). Owns teams, a service portal and request types.                                                                 |
| **Team**              | Working group inside a department. Owns issues, workflow, cycles. Has a short key (e.g. `ITOPS`) used in issue identifiers (`ITOPS-142`).                                             |
| **Member**            | A user account inside an organization. Can belong to several teams across departments.                                                                                                |
| **Issue**             | Unit of internal work owned by one team.                                                                                                                                              |
| **Request**           | Unit of cross-department work: created by a requester from department A via the portal of department B. Becomes visible to B's triage queue. Has requester-facing and internal sides. |
| **Request group**     | A request sent to several departments at once: one shared description and approvals, one child request per target department (§6.4).                                                  |
| **Request type**      | Template for a request: form fields, routing target team, SLA policy, approval policy. Defined by the receiving department.                                                           |
| **Service portal**    | Per-department catalog of request types available to other departments.                                                                                                               |
| **Approval**          | A decision (approve / reject / request changes) required from a designated approver before the request can proceed.                                                                   |
| **Approval policy**   | Ordered set of approval steps attached to a request type, or added by the requester.                                                                                                  |
| **Approval step**     | One stage of an approval policy: approver selector + decision rule (any / all / quorum).                                                                                              |
| **Approver selector** | Rule resolving to concrete users: a user, a role in a department, a team lead, the requester's manager, etc.                                                                          |
| **Workflow**          | Set of statuses and allowed transitions for a team's issues or a request type.                                                                                                        |
| **Status category**   | Fixed semantic bucket every status maps to: `backlog`, `unstarted`, `started`, `completed`, `canceled` (+ `pending_approval`, `waiting_for_requester` for requests).                  |
| **Cycle**             | Time-boxed iteration (sprint) of a team.                                                                                                                                              |
| **Project**           | Set of issues (possibly across teams) with a goal, lead, target date.                                                                                                                 |
| **Initiative**        | Group of projects aligned with an organizational objective.                                                                                                                           |
| **View**              | Saved filter + display configuration over issues/requests.                                                                                                                            |
| **Inbox**             | Per-user notification feed.                                                                                                                                                           |
| **SLA**               | Service level target (time to first response, time to resolution) attached to a request type.                                                                                         |
| **Role**              | Named set of permissions, granted to a member at a **scope** (organization, department, team).                                                                                        |
| **Permission**        | Atomic capability string, e.g. `issue.create`, `request.approve`.                                                                                                                     |

---

## 3. Organization structure

```
Organization (= the installation)
├── Department: IT
│   ├── Team: Helpdesk        (key HELP)
│   ├── Team: Infrastructure  (key INFRA)
│   └── Service portal: "IT Services" → request types
├── Department: Finance
│   ├── Team: Accounting      (key ACC)
│   └── Team: Procurement     (key PROC)
└── Department: Customer Support
    └── Team: Tier 1          (key CS1)
```

Rules:

- A department has 1..N teams; a team belongs to exactly one department.
- A member can belong to many teams (in any departments). One department is the member's
  **home department** — used for "requester's department" approver resolution and reports.
- A department has an optional **head** (a member) and optional **supervisors**
  (members holding the `Department Supervisor` role in that department).
- Team keys are unique per organization, 2–10 uppercase letters/digits.
- Departments and teams are archived, never hard-deleted, while they own issues/requests.
- Optional `manager` field on a member (for "requester's manager" approvals).

---

## 4. Access control (RBAC)

### 4.1 Model

- **Permission** — atomic string from a fixed catalog defined in code (§4.3).
- **Role** — named set of permissions. System roles are seeded and read-only;
  organization admins can create **custom roles**.
- **Role assignment** — `(member, role, scope)` where scope is one of:
  `organization`, `department:<id>`, `team:<id>`.
- **Scope inheritance** — a grant at organization scope applies to every department and team;
  a grant at department scope applies to all teams of that department.
- **Resolution** — effective permissions = union of all grants whose scope contains the
  target resource. v1 has no explicit deny.
- **Resource-level overrides** — a team can be marked _private_: only its members
  (and org admins) can see its issues. Requests are always visible to their requester,
  approvers, watchers and the receiving team.
- **Authorization is enforced on the server** for every read and write. The UI uses the
  same permission catalog only to hide/disable controls.

### 4.2 System roles

| Role                  | Default scope   | Summary                                                                                                            |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Organization Owner    | org             | Everything, incl. instance settings, transferring ownership. One or more owners; the last owner cannot be removed. |
| Organization Admin    | org             | Admin panel: members, departments, teams, roles, policies, audit log.                                              |
| Department Admin      | department      | Manage teams, portal, request types, workflows and approval policies of the department.                            |
| Department Supervisor | department      | Approve requests where the selector is "supervisor of this department"; see all department work.                   |
| Team Lead             | team            | Manage team settings, workflow, cycles; triage incoming requests.                                                  |
| Member                | team            | Create/edit issues, comment, create requests to other departments.                                                 |
| Viewer                | team/department | Read-only.                                                                                                         |
| Guest                 | org             | Can only create requests and see own requests (e.g. contractors).                                                  |

### 4.3 Permission catalog (v1)

```
instance.manage            org.manage                  org.audit.read
auth.manage                mail.manage
member.invite              member.deactivate           member.role.assign
department.create          department.update           department.archive
team.create                team.update                 team.archive
role.create                role.update                 role.delete
workflow.manage            request_type.manage         approval_policy.manage
sla_policy.manage          portal.manage
issue.read                 issue.create                issue.update
issue.delete               issue.assign                issue.move_team
comment.create             comment.delete_any
cycle.manage               project.manage              initiative.manage
view.create_shared
request.create             request.read_department     request.triage
request.comment_internal   request.approve             request.reassign
api_key.manage             webhook.manage              integration.manage
token.create_personal      mcp.use
```

Every permission check in code references these constants from a single shared module
(`packages/shared/permissions`). Adding a permission = adding a constant + migration that
updates system roles + tests.

### 4.4 Default permission matrix (abridged)

| Permission                     | Owner | Org Admin | Dept Admin | Dept Supervisor | Team Lead | Member | Viewer | Guest |
| ------------------------------ | :---: | :-------: | :--------: | :-------------: | :-------: | :----: | :----: | :---: |
| instance.manage                |   ✓   |           |            |                 |           |        |        |       |
| org.manage                     |   ✓   |     ✓     |            |                 |           |        |        |       |
| auth.manage, mail.manage       |   ✓   |     ✓     |            |                 |           |        |        |       |
| member.invite                  |   ✓   |     ✓     |     ✓¹     |                 |           |        |        |       |
| department.create              |   ✓   |     ✓     |            |                 |           |        |        |       |
| team.create                    |   ✓   |     ✓     |     ✓      |                 |           |        |        |       |
| request_type.manage            |   ✓   |     ✓     |     ✓      |                 |           |        |        |       |
| approval_policy.manage         |   ✓   |     ✓     |     ✓      |                 |           |        |        |       |
| request.approve                |  ✓²   |    ✓²     |     ✓²     |       ✓²        |    ✓²     |   ✓²   |        |       |
| request.triage                 |   ✓   |     ✓     |     ✓      |                 |     ✓     |        |        |       |
| issue.create                   |   ✓   |     ✓     |     ✓      |        ✓        |     ✓     |   ✓    |        |       |
| issue.read                     |   ✓   |     ✓     |     ✓      |        ✓        |     ✓     |   ✓    |   ✓    |       |
| request.create                 |   ✓   |     ✓     |     ✓      |        ✓        |     ✓     |   ✓    |        |   ✓   |
| token.create_personal, mcp.use |   ✓   |     ✓     |     ✓      |        ✓        |     ✓     |   ✓    |   ✓    |       |
| org.audit.read                 |   ✓   |     ✓     |            |                 |           |        |        |       |

¹ Only into own department. ² The permission is necessary but not sufficient: a user can
approve a specific request only if the approval step's selector resolves to them (§6.3).

---

## 5. Internal work management (Linear-like)

### 5.1 Issue

| Field               | Notes                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifier          | `<TEAM_KEY>-<number>`, sequential per team, immutable. Moving to another team assigns a new identifier and keeps the old one as an alias/redirect. |
| Title               | Required, ≤ 255 chars.                                                                                                                             |
| Description         | Rich text stored as Markdown: formatting, pasted images and files (stored in PostgreSQL), Mermaid diagrams; mentions later.                        |
| Status              | From team workflow; always maps to a status category.                                                                                              |
| Priority            | `none`, `urgent`, `high`, `medium`, `low`.                                                                                                         |
| Assignee            | One member of the team (or none); teams may allow several (setting).                                                                               |
| Labels              | Organization-level and team-level labels, grouped.                                                                                                 |
| Estimate            | Optional, team-configurable scale (points / t-shirt).                                                                                              |
| Cycle, Project      | Optional.                                                                                                                                          |
| Due date            | Optional.                                                                                                                                          |
| Parent / sub-issues | Unlimited depth in data, UI shows 2 levels.                                                                                                        |
| Relations           | `blocks` / `blocked_by`, `related`, `duplicate_of`.                                                                                                |
| Source request      | Link to the request that spawned it (§6).                                                                                                          |
| Watchers            | Auto: creator, assignee, mentioned users.                                                                                                          |
| Activity            | Immutable history of field changes + comments.                                                                                                     |

### 5.2 Team features

- **Workflow editor**: add/rename/reorder statuses inside categories; default status for new
  issues; auto-close stale issues (optional); auto-archive completed after N months.
- **Triage**: incoming requests and issues created by non-members land in triage first.
  Actions: accept (choose status/assignee), mark duplicate, decline (with reason), snooze.
- **Cycles**: duration, start day, cooldown, automatic rollover of unfinished issues,
  burn-up chart, scope change tracking.
- **Projects**: name, lead, members, teams, start/target dates, status updates, milestones,
  progress = completed / total scope.
- **Initiatives**: group projects, owner, target date, health (on track / at risk / off track).

### 5.3 Navigation (left sidebar)

Mirrors the Linear layout, extended with request work:

```
[Company logo/name]                  [Search] [New issue]
Inbox                                   99+
My issues
My requests            ← requests I created
Approvals              ← items waiting for my decision (badge)

Workspace
  Initiatives
  Projects
  Views
  Service portals      ← catalog of all departments' request types

Your departments
  IT ▾
    Requests           ← department-wide request queue
    Helpdesk ▾
      Triage
      Issues
      Cycles  (Current / Upcoming)
      Projects
      Views
    Infrastructure ▸
  Finance ▸
```

### 5.4 UX requirements

- Command palette (`Cmd/Ctrl+K`) for every action; keyboard shortcuts for create (`C`),
  assign (`A`), status (`S`), priority (`P`), label (`L`), navigation (`G` then `I`/`P`/…).
- List, board (kanban) and timeline layouts for issues and projects.
- Grouping, sorting, filtering by any field; filters serializable to URL and savable as Views.
- Optimistic updates; real-time sync of changes from other users (< 1 s).
- Light / dark theme, follows OS by default.
- Full-text search across issues, requests, comments, projects (permission-filtered).

---

## 6. Cross-department requests (JSM-like)

### 6.1 Service portal and request types

Each department has a **service portal** listing its request types, grouped into categories.
A Department Admin configures each request type:

| Setting                           | Description                                                                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name, description, icon, category | Shown in the portal.                                                                                                                                                                                           |
| Form                              | Field builder: text, long text, number, date, select (single/multi), user picker, department picker, attachment, checkbox. Required flag, help text, conditional visibility (show field X if field Y = value). |
| Who can submit                    | All members / specific departments / specific roles.                                                                                                                                                           |
| Routing                           | Target team (default triage), optional routing rules by field value (e.g. `category = Hardware → INFRA`).                                                                                                      |
| Workflow                          | Request workflow (statuses mapped to categories incl. `pending_approval`, `waiting_for_requester`).                                                                                                            |
| SLA policy                        | Targets for first response and resolution, per priority, with business hours calendar.                                                                                                                         |
| Approval policy                   | Mandatory steps (§6.3) + whether the requester may **add optional approvals**.                                                                                                                                 |
| Auto-create issue                 | Optionally create an internal issue in the target team on acceptance.                                                                                                                                          |

### 6.2 Request lifecycle

```
draft ──submit──▶ pending_approval ──all steps approved──▶ open (in triage)
                     │       │                                 │
                     │       └─changes requested─▶ waiting_for_requester ─resubmit─┐
                     │                                                             │
                     └─rejected─▶ rejected (closed)              ◀─────────────────┘
open ──accept──▶ in_progress ──▶ waiting_for_requester ⇄ in_progress ──▶ resolved ──▶ closed
                                                                  └─(reopen within N days)
```

- Without an approval policy the request goes directly to `open`.
- The requester sees: status (requester-facing label), public comments, attachments,
  approval progress, SLA expectation. The requester never sees internal comments or linked
  internal issues' details (only their aggregate progress, if enabled).
- The receiving team sees everything and can: comment publicly or **internally**, link or
  spawn internal issues, reassign to another team in the department, change priority,
  transfer to another department (with `request.reassign`).
- When all linked issues complete, the request can auto-move to `resolved` (configurable).
- Requester confirms resolution or the request auto-closes after N days.

### 6.3 Approvals

This is the core cross-department feature.

**Example scenario.** Customer Support needs IT to purchase and set up 20 headsets.
The CS agent opens _IT Services → Hardware purchase_. IT has configured this request type
with a mandatory step "Supervisor of the requester's department". Because the purchase
costs money, the CS agent also ticks **"Requires approval from Finance"** and selects
_Finance → Department Supervisor_. On submit:

1. Request `IT-REQ-57` is created in status `pending_approval`.
2. Step 1 (CS supervisor) is activated; CS supervisors receive an Inbox notification + email.
3. After CS supervisor approves, step 2 (Finance supervisor) is activated.
4. Finance supervisor approves → request moves to `open` in IT Helpdesk triage.
5. Any rejection closes the request as `rejected` with a mandatory reason visible to the requester.

**Approval step configuration**

| Attribute         | Values                                                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approver selector | `user:<id>` · `role:<role>@department:<id>` (e.g. Finance Supervisor) · `department_head:<id>` · `requester_department_supervisor` · `requester_manager` · `team_lead:<id>` · `field:<user_picker_field>` (approver chosen in the form) |
| Decision rule     | `any` (first decision wins) · `all` · `quorum:N`                                                                                                                                                                                        |
| Order             | Steps run **sequentially**; approvers inside one step decide **in parallel**.                                                                                                                                                           |
| Origin            | `mandatory` (from request type, cannot be removed by requester) · `requester_added` (optional, if request type allows).                                                                                                                 |
| Timeout           | Optional: after T business hours → reminder, then escalate to a fallback selector, or auto-reject.                                                                                                                                      |
| Condition         | Optional: activate the step only if a field matches (e.g. `amount > 1000`).                                                                                                                                                             |

**Rules**

- **Segregation of duties**: the requester cannot approve their own request; if a selector
  resolves only to the requester, the step escalates to the fallback selector, or to the
  Department Admin of the approving department.
- Selectors are resolved **at step activation time**; the resolved approver list is stored
  on the step so later org changes do not silently change who may decide. Admins can
  re-resolve manually (audited).
- **Delegation**: a member can set an out-of-office delegate for a date range; delegated
  decisions record both the delegate and the original approver.
- Decisions: `approve`, `reject` (reason required), `request_changes` (comment required →
  `waiting_for_requester`; resubmission restarts the current step).
- Editing form fields that are marked _approval-relevant_ after an approval resets the
  approvals of steps already passed (configurable per request type).
- Every decision is immutable and recorded in the audit log with actor, time, comment,
  and the request snapshot hash the approver saw.
- Every decision requires a signed-in approver. Approvers act from the **Approvals**
  sidebar page, Inbox, or the request page. Email notifications contain only a deep link to
  the request; opening it without a session goes through sign-in and returns to the
  request. There is no token-only or one-click approval from email.
- Approvals are visible to: requester, approvers, receiving department, watchers.

### 6.4 Multi-department requests

A requester can send one request to **several departments at once** (e.g. a new hire
needs IT equipment, Finance payroll setup and Facilities a desk).

- The requester picks one request type per target department; each type's form is shown,
  shared fields (title, description, attachments, due date) are entered once.
- Submitting creates a **request group** (`REQ-G-12`) and one **child request** per
  department, each with its own number, triage, workflow, assignee and SLA.
- Approvals: steps added by the requester apply to the whole group and run **before** any
  child is released; mandatory steps of each request type apply to that child only.
  A rejection at group level rejects all children; a rejection of one child's mandatory
  step rejects only that child.
- Group status is derived: `pending_approval` while group steps are open, `in_progress`
  while any child is active, `resolved` when every child is resolved or declined.
- The requester sees the group with each department's progress; each department sees only
  its own child plus the names and statuses of sibling requests (no internal comments).
- A receiving team with `request.reassign` can add another department to an existing
  request; it becomes a group with the original request as the first child.

### 6.5 SLA

- Targets per request type and priority: time to first response, time to resolution.
- Business-hours calendars per department (timezone, working days, holidays).
- Clock pauses in `pending_approval` (configurable) and `waiting_for_requester`.
- Visual indicator on requests: on track / at risk (≥ 75 % elapsed) / breached.
- Breach and at-risk events produce notifications and are available as webhook events.

---

## 7. Notifications and Inbox

- Events: assigned, mentioned, status changed on watched item, comment on watched item,
  approval requested / decided, SLA at risk / breached, request resolved, due date reached.
- Channels: Inbox (always), email and Slack (per-event user preference, §7.1); Microsoft
  Teams in Phase 3.
- Inbox actions: mark read/unread, snooze, archive, unsubscribe from thread; keyboard driven.
- Digest emails (optional daily summary).
- Notification fan-out runs asynchronously in the job queue; delivery is idempotent.

### 7.1 Slack integration

Modelled on Linear's Slack integration, delivered in two levels. Both are configured per
installation, since every company runs its own Ordler.

**Level 1: channel notifications via Slack incoming webhooks (Phase 1)**

- A Team Lead, Department Admin or Org Admin adds a **channel subscription**: a Slack
  incoming-webhook URL plus the scope it watches (a team, a department's request queue,
  a project) and the events to send.
- Events: issue created, status changed, assigned, commented; request created, approval
  requested/decided, request resolved; SLA at risk/breached (when SLA ships). Optional
  filters: priority, labels, request type.
- Messages use Slack Block Kit: identifier, title, status, priority, assignee, a short
  excerpt and an **Open in Ordler** button (a plain link). No interactive actions.
- The webhook URL is a secret: encrypted at rest, write-only in UI and API, redacted in
  logs and the audit log. A **Send test message** button validates it.
- Works behind a firewall as long as Ordler can reach `hooks.slack.com` outbound.

**Level 2: Ordler Slack app (Phase 2)**

- The admin creates a Slack app in their workspace from an app manifest shipped by Ordler
  (Admin → Integrations → Slack shows the manifest and setup steps), then pastes the bot
  token and signing secret. Connection uses **Socket Mode** by default, so no public inbound
  URL is needed for on-prem installs; the Events API over HTTPS is an alternative.
- **Personal notifications**: members link their Slack account once (Slack OAuth from
  their Ordler settings) and receive their Inbox events as Slack DMs, filtered by the same
  per-event preferences, in their own language.
- **Channel subscriptions** move from raw webhook URLs to a channel picker.
- **Link unfurls**: Ordler links pasted in Slack expand into a preview card for users who
  have linked accounts and may see the item; nothing is shown to others.
- **Generic link previews**: for any other messenger (Teams, WhatsApp, Telegram…) the app
  shell carries Open Graph tags with only the identifier from the URL, the company name and
  the logo. Crawlers are anonymous, so titles, status and even whether the item exists are
  never revealed.
- **Message actions**: "Create request from message" and "Create issue from message"
  (opens an Ordler modal in Slack, prefilled with the message text and a link back).
- Approvals stay in Ordler (§6.3): Slack messages for approvals carry only an
  **Open in Ordler** button; deciding requires a signed-in Ordler session.

**Rules**

- A message never contains more than the subscribing scope may see: internal comments
  and private-team items go only to channels whose subscription was created inside that
  team, and never to requester-facing channels.
- Delivery runs in the worker with retries and backoff; Slack rate limits (HTTP 429,
  `Retry-After`) are respected; bursts for one channel are batched into a single message.
- Channel messages use the instance default language; DMs use the member's language.
- Every subscription change and Slack connection change is audited.

---

## 8. Admin panel

Accessible to members with any `*.manage` permission; each section is gated by its permission.

| Section                         | Capabilities                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                        | Seats, active users, request volume, SLA compliance; current version and update availability (§16.5).                                                                                             |
| Members                         | Invite (email, bulk CSV), deactivate/reactivate, set home department and manager, view assignments, impersonate-for-support (Owner only, audited, read-only).                                     |
| Departments                     | Create / rename / archive, head, supervisors, business hours calendar.                                                                                                                            |
| Teams                           | Create inside department, key, privacy, members, team lead, move team between departments.                                                                                                        |
| Roles & permissions             | List system roles (read-only), create custom roles from the permission catalog, assign roles at scope, "effective permissions" inspector for any member.                                          |
| Workflows                       | Team workflows and request workflows editor.                                                                                                                                                      |
| Service portals & request types | Form builder, routing rules, SLA, approval policies with a step editor and a "simulate approvers" preview for a sample requester.                                                                 |
| SLA policies & calendars        | Targets, business hours, holidays.                                                                                                                                                                |
| Labels & custom fields          | Org-level labels and custom fields.                                                                                                                                                               |
| Authentication & registration   | Sign-in strategies, self-registration rules, default roles for new accounts (§8.1).                                                                                                               |
| Mail server                     | SMTP configuration used for OTP codes, invites and notifications (§8.2).                                                                                                                          |
| Database                        | Current PostgreSQL connection and server version, without secrets. Owners can change installer-saved settings (applied after restart); settings from environment variables are read-only (§16.4). |
| Security                        | Session lifetime, 2FA enforcement, password policy, IP allowlist (Phase 3).                                                                                                                       |
| API, tokens & MCP               | MCP server on/off, who may create personal tokens, maximum token lifetime, list and revoke any member's tokens, MCP usage log (§10.1). Webhook endpoints and delivery logs with retry (Phase 2).  |
| Integrations                    | Slack: channel subscriptions (Phase 1), Slack app connection with manifest, bot token, signing secret, Socket Mode status, linked members (Phase 2). Microsoft Teams (Phase 3).                   |
| Audit log                       | Searchable, filterable, exportable (CSV/JSON); retention configurable.                                                                                                                            |
| Data                            | Export all data (JSON), import from Linear and Jira via API token (§10.2, Phase 2).                                                                                                               |

### 8.1 Authentication strategies and registration

Modelled on the Wiki.js _Administration → Authentication_ page: the admin sees a list of
**authentication strategies**, enables any combination of them, and configures each one
independently. The sign-in page renders exactly the enabled strategies, in the order the
admin sets.

**Strategies**

| Strategy                      | Phase | Configuration fields                                                                                               |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| Email + password (local)      | 1     | Password policy (min length, complexity, breach check), require email verification.                                |
| Email OTP (passwordless code) | 1     | Code length (6), TTL (10 min), max attempts (5), resend cooldown (60 s). Requires a configured mail server (§8.2). |
| Google                        | 1     | Client ID, client secret, allowed Google Workspace domain (`hd`) — optional.                                       |
| Microsoft Entra ID            | 2     | Tenant ID, client ID, client secret.                                                                               |
| Generic OIDC                  | 2     | Issuer URL (discovery), client ID/secret, scopes, claim mapping (email, name, groups).                             |
| SAML 2.0                      | 3     | IdP metadata URL/XML, entity ID, certificate, attribute mapping.                                                   |
| LDAP / Active Directory       | 3     | URL, bind DN/credentials, search base, filter, TLS.                                                                |

**Per-strategy settings** (common to all strategies, as in Wiki.js):

| Setting                              | Description                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enabled                              | Show the strategy on the sign-in page.                                                                                                                    |
| Display name & order                 | Label and position on the sign-in page.                                                                                                                   |
| Allow self-registration              | If on, an unknown user who authenticates successfully gets an account created automatically. If off, only invited members can sign in with this strategy. |
| Allowed email domains                | Self-registration is limited to these domains (e.g. `company.com`). Empty = any domain.                                                                   |
| Default role & scope on registration | Role (and optionally department/team) assigned to accounts created via this strategy, e.g. `Guest` at org scope.                                          |
| Callback URL                         | Read-only, shown for copying into the IdP console.                                                                                                        |

**Rules**

- At least one strategy must stay enabled; the admin cannot disable the strategy they are
  currently signed in with unless another enabled strategy is linked to their account
  (prevents lock-out). Last-resort recovery: `ordler admin enable-local-auth` CLI (§16.4).
- One member can link several identities (password + Google); identities are matched by
  **verified** email only.
- Secrets (client secrets, SMTP password) are encrypted at rest, write-only in the UI
  (shown as `••••`), never returned by the API, never logged.
- Every change to strategies is recorded in the audit log (secrets redacted).
- Invites work regardless of self-registration: the invite link lets the invitee choose any
  enabled strategy.
- Email verification: local and OTP registrations must confirm the email before access.
- Optional TOTP 2FA (authenticator app) for local accounts; can be enforced per role.

### 8.2 Mail server (SMTP)

Modelled on Wiki.js _Administration → Mail_. Required for email OTP, email verification,
invites, password reset and email notifications. Until configured, strategies that depend
on email are shown as unavailable and admins see a banner.

| Field                      | Notes                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Sender name / sender email | `From` header, e.g. `Ordler <no-reply@company.com>`.                                       |
| SMTP host / port           | e.g. `smtp.company.com` / `587`.                                                           |
| Security                   | `none`, `STARTTLS`, `SSL/TLS`.                                                             |
| Verify TLS certificate     | Toggle (on by default).                                                                    |
| Authentication             | Username + password (encrypted, write-only).                                               |
| DKIM (optional)            | Domain name, key selector, private key.                                                    |
| Send test email            | Sends a test message to an address entered by the admin; shows the SMTP response or error. |

- Until SMTP is configured, only email + password sign-in and invite _links_ (copied
  manually by the admin) work; email OTP is disabled.
- SMTP can also be preset via environment variables (§16.2); values set in env are shown
  read-only in the admin panel.
- Email templates (OTP, invite, verification, password reset, notification digest) are
  localized into every supported language (§11.1), sent in the recipient's language; branding (logo, colors) taken from organization settings. Editable templates in Phase 2.
- Delivery runs through the job queue with retries; failures are visible in the admin panel.

---

## 9. Audit log

Recorded for: authentication events, member lifecycle, role assignments, role definition
changes, department/team changes, workflow/request-type/approval-policy/SLA changes,
every approval decision, permission-relevant settings, API key and webhook changes,
data exports, impersonation.

Entry: `id, actor (member / api key / system), action, target_type,
target_id, before, after, ip, user_agent, created_at`. Append-only; no update/delete API.

---

## 10. Integrations and API

- Public **REST API** documented with OpenAPI 3.1, versioned (`/api/v1`), cursor pagination,
  idempotency keys for POST, rate limiting per key.
- **Webhooks** for issue, request, approval, SLA, comment events; HMAC-signed, retries with
  exponential backoff, delivery log.
- Email-in: create a request by emailing a department address (Phase 2).
- Slack: channel notifications via incoming webhooks (Phase 1); Slack app with DMs, unfurls
  and message actions (Phase 2), see §7.1. Microsoft Teams notifications (Phase 3).
- Git provider links (branch/PR mention → issue) (Phase 3).

### 10.1 MCP server and personal access tokens (Phase 1)

Ordler ships a built-in **MCP (Model Context Protocol) server** so AI agents (Claude,
Cursor, other MCP clients) can work with Ordler on behalf of a member. Like Wiki.js API
access, but self-service: **every member creates tokens for themselves**.

**Personal access tokens (PAT)**

- Created in _Settings → Access tokens_: name, expiry (default 90 days, max set by admin,
  "no expiry" only if the admin allows it), scopes.
- Scopes: `read` (issues, requests, projects, comments the member can see), `issues:write`
  (create/update issues, comment), `requests:write` (create requests, comment on own
  requests). Admin operations are never available through personal tokens.
- Shown once on creation, format `ordl_pat_<random>`; stored only as a hash with a visible
  prefix, last-used time and IP; the member can revoke at any time, admins can revoke any.
- The same tokens authenticate the public REST API (Phase 2).
- Creating a token requires `token.create_personal` (granted to all roles except Guest by
  default; the admin can restrict it to selected roles).

**MCP server**

- Endpoint `POST /mcp` on the Ordler base URL, MCP Streamable HTTP transport, token in the
  `Authorization: Bearer` header. Requires `mcp.use` and the MCP switch enabled in admin.
- OAuth 2.1 authorization for MCP clients that support it (no copy-paste of tokens),
  Phase 2.
- The agent acts **as the member**: every tool call goes through the same RBAC, visibility
  rules and validation as the UI; a token can never do more than its owner, and scopes can
  only narrow that.
- Tools (MVP):
  - `search` — full-text search over visible issues, requests, projects
  - `get_issue`, `list_my_issues`, `list_team_issues` (filters: status, assignee, label, cycle)
  - `create_issue`, `update_issue` (status, assignee, priority, labels, description), `add_comment`
  - `list_service_portals`, `get_request_type_form`, `create_request` (incl. multi-department)
  - `get_request`, `list_my_requests`
  - `list_my_approvals` (read-only)
  - `list_teams`, `list_members`, `whoami`
- Resources: `ordler://issue/HELP-142`, `ordler://request/IT-REQ-57`, `ordler://team/HELP`,
  so clients can attach items as context.
- **Approvals cannot be decided through MCP or tokens**: `list_my_approvals` is read-only;
  approve/reject/request changes remain human actions in the signed-in UI (§6.3).
- Every write is recorded in the audit log and activity history as the member _via token
  "<name>"_, so humans see what an agent did.
- Rate limits per token (default 120 requests/min); tool results are paginated and
  truncated to keep responses small for agents.
- Tool descriptions are English; returned data keeps the original language of the content.

### 10.2 Import from Linear and Jira (Phase 2)

Companies switch to Ordler with years of history in Linear or Jira. Import moves that work
over once (or repeatedly during a trial period) without losing context. Import uses only
the source's API with a token: Ordler must be able to reach Linear or the Jira server.

**Sources (token only)**

| Source                    | Access                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Linear                    | GraphQL API with a personal API key; Ordler only reads                                 |
| Jira Cloud                | REST API v3 with the account email and an API token; scope chosen with JQL             |
| Jira Server / Data Center | REST API v2 with a personal access token; internal URLs allowed; scope chosen with JQL |

File-based import (CSV/XML exports) is not supported: exports lose comments, attachments and
relations.

**Wizard (Admin → Import, requires `org.manage`)**

1. **Connect**: choose the source and enter the API key or token; Ordler checks it with one
   read-only call and shows whose account it belongs to. Tokens are
   encrypted at rest, write-only, used only for this import and deleted when it finishes.
   Jira base URLs must be `https`; private network addresses are allowed (Server/DC is
   usually internal) because only org admins can start an import.
2. **Scope**: Linear teams (and optionally projects/cycles), Jira projects or any JQL
   (e.g. `project = IT AND updated >= -365d`); include or skip completed/canceled and
   archived items.
3. **Map** (pre-filled, editable):
   - Linear team / Jira project → existing Ordler team, or a new team in a chosen
     department; the key is suggested from the source key.
   - Statuses → the team's workflow by category: Linear state types map one-to-one
     (backlog, unstarted, started, completed, canceled); Jira status categories To Do /
     In Progress / Done → unstarted / started / completed, with resolutions such as
     "Won't Do" or "Duplicate" → canceled. Missing statuses can be created in the workflow.
   - Priority: Linear 0–4 → none / urgent / high / medium / low; Jira Highest → urgent,
     High → high, Medium → medium, Low and Lowest → low.
   - People matched by email to Ordler members; unmatched people can be invited, mapped to
     someone else, or kept as a plain name on imported content ("Imported from Jira:
     Jane Doe").
   - Labels and Jira components → team labels; Jira issue types (Bug, Story, Task…) →
     labels such as `type:Bug`, so nothing is lost before custom fields exist.
   - Hierarchy: Linear parent/sub-issues and Jira sub-tasks → Ordler sub-issues; Jira
     epics → parent issues (or projects once Projects ship).
   - Cycles / sprints → cycles; estimates / story points → estimate.
4. **Dry run**: counts per team, unmapped people, unmapped statuses, attachments that exceed
   `ATTACHMENT_MAX_MB`, and warnings — nothing is written yet.
5. **Run**: a background job (PostgreSQL job table, so it survives restarts and runs on one
   replica), throttled to the source API limits, with live progress, pause/cancel and
   resume from the last item.
6. **Report**: imported / updated / skipped / failed items with reasons, downloadable as CSV;
   the whole run is recorded in the audit log.

**What comes over**

- Title, description (Linear Markdown as is; Jira ADF or wiki markup converted to
  Markdown, mentions become Ordler mentions when the person is mapped), status, priority,
  assignee(s), labels, due date, estimate, creator, original created/updated times.
- Comments with their original author and time; attachments and inline images downloaded
  into PostgreSQL (§8 attachments), with links rewritten.
- Parent/sub-issue links; relations `blocks` / `blocked by` / `relates to` / `duplicates`.
- Field history is not replayed: each issue gets one history entry "Imported from Linear
  ENG-123" with a link to the original, plus the import run in the audit log.

**Identifiers and repeat runs**

- Imported issues get new Ordler identifiers (`TEAMKEY-n`); the source key (`ENG-123`,
  `IT-42`) is kept as an alias: searching for it or opening `/issue/ENG-123` finds the
  Ordler issue.
- A mapping table `external_refs (source, external_id → ordler_id)` makes import idempotent:
  running it again updates changed items and adds new ones instead of duplicating, which
  allows a trial period with both tools before switching over.
- Imported items never trigger notifications, Slack posts or emails.

**Out of scope for the first version**: Jira Service Management requests and approval
history become plain issues (mapping to Ordler requests is Phase 3); Jira custom fields are
appended to the description as a table; workflows' transition rules are not imported.

**Acceptance criteria**

1. An org admin imports a Linear team with sub-issues, comments and images through the API;
   statuses, priorities, assignees and parent links match the source, and images open from
   Ordler with Linear unreachable.
2. A Jira Server project behind the firewall is imported with JQL; ADF/wiki descriptions
   render as Markdown; epics become parents of their stories.
3. A Jira Cloud project is imported with email + API token; an invalid or revoked token is
   refused at the Connect step with a clear message.
4. Running the import twice creates no duplicates and updates items changed in between.
5. Searching `ENG-123` finds the imported issue; no member received a notification during the
   import; tokens are not readable through the API after the run.

---

## 11. Non-functional requirements

| Area          | Requirement                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Performance   | API p95 < 200 ms for reads, < 400 ms for writes at 1k concurrent users on the reference sizing (2 app replicas × 2 vCPU/4 GB, PostgreSQL db.m6g.large); list of 1 000 issues renders < 1 s; UI interactions feel instant via optimistic updates. |
| Real-time     | Changes propagate to connected clients < 1 s (WebSocket).                                                                                                                                                                                        |
| Availability  | Zero-downtime rolling upgrades in Kubernetes with ≥ 2 replicas; stateless app nodes (all state in PostgreSQL and file storage).                                                                                                                  |
| Scalability   | 10k members and 1M issues per installation without degradation; horizontal scaling by adding replicas.                                                                                                                                           |
| Security      | OWASP ASVS L2, TLS 1.2+, passwords hashed with Argon2id, CSRF protection, strict CSP, secrets never logged, attachments scanned and served via signed URLs.                                                                                      |
| Privacy       | GDPR: data export, account deletion (pseudonymize authored content). No telemetry leaves the installation unless the admin opts in.                                                                                                              |
| Accessibility | WCAG 2.1 AA, full keyboard operability, screen-reader labels.                                                                                                                                                                                    |
| Observability | Structured JSON logs, OpenTelemetry traces, metrics, error tracking.                                                                                                                                                                             |
| Backups       | Database backups are the operator's responsibility (e.g. RDS automated backups); docs describe backup/restore of DB + file storage. Admin panel offers full JSON export.                                                                         |

### 11.1 Localization

Supported languages at launch (Phase 1): **English (`en`, source), Russian (`ru`),
German (`de`), Azerbaijani (`az`, Latin script)**.

- All UI strings, validation messages, email templates and system notifications are
  externalized; no hard-coded user-facing text.
- ICU MessageFormat for plurals and gender (Russian has 3 plural forms, Azerbaijani/German 2).
- Language resolution: user preference → instance default (admin) → browser `Accept-Language` → `en`.
- Dates, numbers, relative times formatted with `Intl` in the user's locale and timezone.
- Language switcher in user settings and on the sign-in page.
- Layout tolerates ~35 % longer strings (German) without truncation of key actions.
- Admin-entered content (department names, request type names, form labels, status names)
  can be given per-language translations; falls back to the default language.
- CI check: every locale has every key of `en`; missing/extra keys fail the build.
- Search: PostgreSQL text search configs per language (`english`, `russian`, `german`,
  `simple` for Azerbaijani) with `unaccent`.

---

## 12. Architecture

See [ADR 0001](adr/0001-tech-stack.md) for the rationale. Summary:

- **Monorepo**: pnpm workspaces + Turborepo.
  - `apps/web` — React + TypeScript SPA (Vite, TanStack Router, TanStack Query,
    Tailwind CSS, Radix UI primitives).
  - `apps/api` — Node.js + TypeScript (NestJS), REST + WebSocket gateway.
  - `apps/worker` — background jobs (notifications, SLA timers, webhooks, approval timeouts).
  - `packages/shared` — Zod schemas, DTO types, permission catalog, status categories.
  - `packages/ui` — design-system components.
- **Data**: PostgreSQL 18+ is the **only required dependency** (like Wiki.js): primary store,
  job queue (pg-boss), real-time fan-out between replicas (`LISTEN/NOTIFY`), full-text search.
  Redis is optional (cache) for large installations.
- **File storage** (attachments): local volume (single replica) or S3-compatible bucket
  (required for > 1 replica).
- **Auth**: pluggable strategy modules (local, email OTP, OAuth/OIDC, later SAML/LDAP)
  behind one interface; session cookies (httpOnly, SameSite=Lax); API keys for the public API.
- **Mail**: Nodemailer with the SMTP transport from admin settings, sent from the worker.
- **Deployment**: one Docker image, Docker Compose and Helm chart (§16).

### 12.1 Core data model (simplified)

```
instance_settings(id, company_name, base_url, default_locale, branding JSONB, setup_completed_at)
member(id, email, email_verified_at, name, locale, timezone, home_department_id, manager_id, status)
auth_strategy(id, kind, enabled, position, display_name, config JSONB,
              secrets_encrypted, allow_self_registration, allowed_domains[],
              default_role_id, default_scope_type, default_scope_id)
member_identity(id, member_id, strategy_id, provider_subject, created_at)
member_invite(id, member_id, token_hash, expires_at, accepted_at, created_by, created_at)
otp_challenge(id, email, code_hash, purpose, attempts, expires_at, consumed_at)
mail_settings(id, sender_name, sender_email, host, port, security, verify_tls,
              username, password_encrypted, dkim JSONB)
department(id, name, head_member_id, calendar_id, archived_at)
team(id, department_id, key, name, is_private, archived_at)
team_membership(team_id, member_id)
role(id, name, is_system)
role_permission(role_id, permission)
role_assignment(id, member_id, role_id, scope_type, scope_id)

workflow(id, owner_type, owner_id)
workflow_status(id, workflow_id, name, category, position)

issue(id, team_id, number, title, description, status_id, priority,
      assignee_id, estimate, cycle_id, project_id, parent_id, source_request_id,
      due_date, created_by, created_at, updated_at, archived_at)
issue_relation(issue_id, related_issue_id, type)
label(id, team_id NULL, name, color, group_id)
cycle(id, team_id, number, starts_at, ends_at)
project(id, name, lead_id, status, start_date, target_date)
initiative(id, name, owner_id, target_date)

service_portal(id, department_id, name)
request_type(id, portal_id, name, form_schema JSONB, routing JSONB, workflow_id,
             sla_policy_id, approval_policy_id, allow_requester_approvals)
request_group(id, number, requester_id, title, description, status, created_at)
request(id, group_id NULL, request_type_id, number, requester_id, requester_department_id,
        target_department_id, target_team_id, status_id, priority, form_data JSONB,
        sla_state JSONB, created_at, resolved_at, closed_at)
request_group_approval_step(id, group_id, position, selector JSONB, rule,
                            resolved_approver_ids, status, activated_at, completed_at)
approval_policy(id, name)
approval_policy_step(id, policy_id, position, selector JSONB, rule, condition JSONB,
                     timeout JSONB, fallback_selector JSONB)
request_approval_step(id, request_id, position, origin, selector JSONB, rule,
                      resolved_approver_ids, status, activated_at, completed_at)
approval_decision(id, request_approval_step_id, approver_id, on_behalf_of_id, decision,
                  comment, snapshot_hash, created_at)

comment(id, subject_type, subject_id, author_id, body, visibility, created_at)
attachment(id, subject_type, subject_id, storage_key, mime, size)
notification(id, member_id, event_type, subject_type, subject_id, read_at, snoozed_until)
chat_subscription(id, provider, scope_type, scope_id, target_encrypted, events[], filters JSONB,
                  created_by, created_at)
chat_connection(id, provider, workspace_id, bot_token_encrypted, signing_secret_encrypted, mode)
member_chat_identity(member_id, provider, external_user_id, linked_at)
personal_access_token(id, member_id, name, token_hash, prefix, scopes[], expires_at,
                      last_used_at, last_used_ip, revoked_at, created_at)
audit_log(id, actor_type, actor_id, action, target_type, target_id,
          before JSONB, after JSONB, ip, user_agent, created_at)
```

---

## 13. Quality requirements

- **Every change to UI or server code ships with unit tests** covering the new or changed
  behaviour; bug fixes start with a failing regression test.
- Coverage gate in CI: ≥ 80 % lines for `packages/shared` and domain modules of `apps/api`
  (permissions, approvals, SLA, workflow transitions must be ≥ 95 %).
- Integration tests for API endpoints against a real PostgreSQL (Testcontainers), on the
  every supported PostgreSQL major (18 at launch; the newest major is added once it is GA on
  AWS RDS).
- Deployment checks in CI: image build, `helm lint` + `helm template` snapshot tests,
  Compose smoke test (start → `/readyz` → setup wizard), concurrent-migration test.
- Locale parity check for en/ru/de/az (§11.1).
- E2E tests (Playwright) for critical flows: sign-in, create issue, cross-department request
  with two-step approval, admin role assignment.
- Static checks in CI: TypeScript strict, ESLint, Prettier, dependency audit.
- Every PR adds a changelog entry in `.ai/changelog/` (see `.ai/README.md`).

---

## 14. Delivery phases

### Phase 1 — MVP

- Auth strategies: email + password, email OTP, Google; self-registration settings per
  strategy (allowed domains, default role); SMTP configuration with test email.
- Setup wizard (first admin, company name, base URL, default language), member invites.
- Docker image, Docker Compose example, Helm chart; external PostgreSQL incl. RDS with TLS (§16).
- UI and emails in en, ru, de, az.
- Departments, teams, membership; system roles; role assignment at scope; server-side RBAC.
- Admin panel: members, departments, teams, roles (system + custom), audit log (read).
- Issues: CRUD, statuses/workflow per team, priority, assignee, labels, sub-issues,
  comments, attachments, activity history.
- Team views: list + board, filters, My issues.
- Service portal, request types with form builder (basic field types), routing to team triage.
- Requests: lifecycle, public/internal comments, link/spawn issues, My requests.
- Multi-department requests (request groups) with group-level approvals.
- **Approvals**: sequential steps, `any`/`all` rules, selectors `user`, `role@department`,
  `requester_department_supervisor`, `department_head`; requester-added approvals;
  Approvals page; SoD rule.
- Inbox + email notifications; Slack channel notifications via incoming webhooks.
- Personal access tokens and the built-in MCP server (§10.1).

**MVP acceptance criteria**

1. An org admin can create departments IT, Finance, Customer Support, create teams inside
   them, invite members and assign roles; a member without `team.create` cannot create a
   team via UI or API (HTTP 403).
2. A CS member submits an IT request with a mandatory CS-supervisor step and an added
   Finance-supervisor step; the request becomes visible in IT triage only after both approvals.
3. A rejection by the Finance supervisor closes the request with the reason visible to the requester.
4. The requester cannot approve their own request even if they hold the supervisor role.
5. Every approval decision and role change appears in the audit log.
6. IT internal comments are never returned by any API the requester can call.
7. An admin can enable Google sign-in with self-registration limited to `company.com`;
   a `company.com` user signing in with Google for the first time gets an account with the
   configured default role, while a `gmail.com` user is refused.
8. With email/password disabled and email OTP enabled, a member signs in with a code sent
   through the configured SMTP server; an expired or 6th wrong code is rejected.
9. `helm install` with `externalDatabase` pointing at an RDS instance (`sslmode=verify-full`
   with the RDS CA bundle) brings up a working installation; a fresh database is migrated
   automatically, and the setup wizard appears on first visit.
10. Upgrading the image tag runs pending migrations exactly once even with 3 replicas
    starting simultaneously.
11. Switching the UI language to ru/de/az translates every screen of the MVP flows and the
    OTP/invite emails; the locale-key CI check passes.
12. A CS member sends one request to IT and Finance with an added CS-supervisor step; after
    approval two child requests appear, one in each department's triage; the group shows
    `resolved` only when both children are resolved.
13. Opening an approval link from an email without a session redirects to sign-in and back;
    no endpoint accepts an approval decision without an authenticated session.
14. A Team Lead subscribes a Slack channel (incoming webhook) to their team's new issues and
    status changes; creating an issue posts one message with an Open in Ordler link within
    10 s; the webhook URL is never returned by the API.
15. A member creates a personal token with `read` and `issues:write`, connects an MCP client
    to `/mcp`, and the agent lists the member's issues and creates an issue in the member's
    team; creating an issue in a team the member cannot access fails; deciding an approval
    is not possible; after revoking the token every call returns 401; the audit log shows
    the agent's writes as the member via that token.

### Phase 2

Cycles, projects, initiatives, saved/shared views, timeline layout, SLA policies with
business hours, approval timeouts/escalation/delegation, conditional steps and fields,
routing rules, webhooks + public API, email-in, import from Linear and Jira via API token (§10.2), editable email templates,
Slack app (DMs, link unfurls, create from message).

### Phase 3

SAML SSO + SCIM provisioning, Microsoft Teams notifications, analytics dashboards (SLA, throughput,
cycle time), automations (rule builder: "when X then Y"), Git integrations, public
external portal, air-gapped install bundle.

---

## 15. Open questions

1. Namespace: GitHub `ordler` is taken by an inactive personal account (checked 2026-10-14);
   `ordlerhq` is free on GitHub and Docker Hub, and `ordlerhq.com` is unregistered.
   Proposed: GitHub org and Docker Hub org `ordlerhq` (images `ordlerhq/ordler`). Confirm and register.
2. Contributions: DCO sign-off (proposed) or a CLA?
3. Documentation site: separate docs domain (e.g. `docs.ordler.com`) or GitHub Pages?

Resolved on 2026-10-14: requests may target several departments (§6.4); approvals always
require sign-in (§6.3); AGPL-3.0 open source, published on GitHub, GHCR and Docker Hub
(§17); PostgreSQL 18+ (§16.3).

---

## 16. Deployment (on-premises)

Modelled on Wiki.js: a single container image, configured by environment variables,
with PostgreSQL as the only mandatory external service.

### 16.1 Artifacts

| Artifact                                                          | Description                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container image `ghcr.io/elkhan-isayev/ordler` (Docker Hub later) | Multi-arch (amd64, arm64), non-root user, read-only root FS. Contains API, worker and built web assets (served by the API on one port). Role selected by `ORDLER_ROLE=all` (default) / `web` / `worker`.                                                    |
| `docker-compose.yml` example                                      | Ordler + optional bundled PostgreSQL, or Ordler alone pointed at an external DB.                                                                                                                                                                            |
| Helm chart `ordler`                                               | Deployment (web), Deployment (worker), Service, Ingress, ConfigMap, Secret, PVC (local storage mode), HPA, PodDisruptionBudget, migration Job (pre-upgrade hook), ServiceAccount. Values for `externalDatabase`, `storage`, `smtp`, `ingress`, `resources`. |
| Docs                                                              | Install (Docker, Compose, Helm), configuration reference, RDS guide, backup/restore, upgrade, sizing.                                                                                                                                                       |

### 16.2 Configuration (environment variables)

| Variable                                                                                                                          | Example                                                       | Notes                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                                    | `postgres://ordler:***@db.xxxx.rds.amazonaws.com:5432/ordler` | Alternative to the `DB_*` set below. Without either, the first-run installer asks for the connection (§16.4).                                     |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` / `DB_PASS_FILE`                                                            |                                                               | `*_FILE` variants read secrets from mounted files (K8s secrets).                                                                                  |
| `DB_SSL`                                                                                                                          | `disable` / `require` / `verify-full`                         | `verify-full` recommended for RDS.                                                                                                                |
| `DB_SSL_CA` / `DB_SSL_CA_FILE`                                                                                                    | RDS global CA bundle                                          |                                                                                                                                                   |
| `DB_SCHEMA`                                                                                                                       | `public`                                                      | Tables go to `public` (dedicated database, like Wiki.js); set a schema to share a database. Installs made before 0.3 keep `ordler` automatically. |
| `DB_POOL_MAX`                                                                                                                     | `20`                                                          | Per replica; size against RDS `max_connections` (or use RDS Proxy / PgBouncer in transaction mode).                                               |
| `BASE_URL`                                                                                                                        | `https://tasks.company.com`                                   | Used in emails and OAuth callbacks.                                                                                                               |
| `ENCRYPTION_KEY` / `ENCRYPTION_KEY_FILE`                                                                                          | 32-byte key                                                   | Encrypts stored secrets (OAuth, SMTP, database password). Optional: generated in the data volume when unset. Losing it = re-entering secrets.     |
| `ORDLER_DATA_DIR`                                                                                                                 | `/data`                                                       | Persistent volume for installer-saved database settings and the generated encryption key.                                                         |
| `ORDLER_INSTALL_TOKEN`                                                                                                            | `K7QX-2M9P-WD4T`                                              | Fixed installer token for automated installs; otherwise a random one is logged.                                                                   |
| `SESSION_TTL_DAYS`                                                                                                                | `30`                                                          | Session lifetime. Sessions are opaque random tokens; only their SHA-256 is stored, so no signing secret exists.                                   |
| `ATTACHMENT_MAX_MB`                                                                                                               | `25`                                                          | Upload limit per file. Attachments are stored in PostgreSQL (ADR 0008), so restarts and rescheduled pods lose nothing.                            |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_VERIFY_TLS`, `SMTP_USER`, `SMTP_PASS` / `SMTP_PASS_FILE`, `SMTP_FROM` (optional) | `smtp.company.com`, `587`, `starttls`                         | Mail delivery for OTP codes and notifications (§8.2). Without it email OTP stays unavailable.                                                     |
| `LOG_LEVEL`, `LOG_FORMAT`                                                                                                         | `info`, `json`                                                |                                                                                                                                                   |
| `ORDLER_ROLE`                                                                                                                     | `all`                                                         |                                                                                                                                                   |
| `TRUST_PROXY`                                                                                                                     | `true`                                                        | Behind ingress / load balancer.                                                                                                                   |

### 16.3 External PostgreSQL / AWS RDS

- Supported: **PostgreSQL 18+** — self-hosted, AWS RDS (18 is GA on RDS since Nov 2025),
  Aurora PostgreSQL, Azure, Cloud SQL. PostgreSQL has no LTS line; every major gets
  5 years of community support (18 until Nov 2030). Policy: the minimum is the newest
  major that is GA on AWS RDS at the time of an Ordler major release; a new PostgreSQL
  major is added to CI and docs once it is GA on RDS; the minimum is raised only in an
  Ordler major release.
- PostgreSQL 18 features used: native `uuidv7()` for time-ordered primary keys, virtual
  generated columns, improved skip-scan for composite indexes.
- The DB user needs no superuser: owning the database (or `CREATE` on it and on its schema) is enough.
  Required extensions (`pgcrypto`, `pg_trgm`, `unaccent`, `citext`) are all available on RDS;
  if the user cannot create them, startup fails with a clear message listing the
  `CREATE EXTENSION` statements for the DBA.
- Migrations run automatically on start, guarded by a PostgreSQL advisory lock so only one
  replica migrates; others wait. `ORDLER_MIGRATE=false` disables auto-migrate (for the Helm
  pre-upgrade Job or DBA-controlled rollouts); `ordler migrate --dry-run` prints pending SQL.
- Startup checks: connectivity, TLS, version, extensions, schema version vs. app version
  (refuses to run against a newer schema).
- Connection loss is retried with backoff; readiness probe fails while the DB is unreachable.

### 16.4 Operations

- Health endpoints: `/healthz` (liveness), `/readyz` (DB reachable, migrations done),
  `/metrics` (Prometheus, optional auth).
- **First-run installer** (ADR 0006): without `DATABASE_URL` / `DB_*`, Ordler serves an
  installer page that asks for the PostgreSQL connection and the one-time install token
  printed in the log (`ORDLER_INSTALL_TOKEN` presets it). It checks reachability, credentials,
  PostgreSQL 18+ and the CREATE privilege, saves the settings to the data volume
  (`ORDLER_DATA_DIR`, password encrypted) and starts Ordler, which creates its tables. Saved
  settings that stop working bring the installer back with the reason. The only prerequisite
  is an empty database and a user that owns it.
- **Setup wizard** on first visit to an empty database: create the first Owner (email +
  password), company name, base URL, default language. Can be pre-seeded via env
  (`ADMIN_EMAIL`, `ADMIN_PASSWORD_FILE`) for automated installs.
- **CLI** inside the image (`ordler <command>`): `migrate`, `admin reset-password <email>`,
  `admin enable-local-auth` (lock-out recovery), `export`, `config check`.
- Upgrades: change image tag; semver; migrations forward-only; release notes list breaking
  config changes. Downgrade = restore DB backup.
- Logs to stdout (JSON); optional OpenTelemetry exporter.
- No outbound internet access required at runtime (except configured SMTP/OAuth providers).

### 16.5 Updates and data safety

**New-version notification**

- The worker checks the GitHub releases of the configured repository
  (`UPDATE_CHECK_REPOSITORY`, default the public Ordler repository) at most once a day, using
  the ETag so unchanged answers cost nothing. Only stable SemVer releases count; drafts and
  pre-releases are ignored. The request carries no installation data.
- The result is stored in the database, so every replica and admin sees the same answer.
  A failed check keeps the last known release and records the error.
- Members with `org.manage` see a banner when a newer version exists: current and latest
  version, release-notes link, a warning for major versions, copy-paste upgrade commands for
  Docker Compose and Helm, and a reminder to snapshot the database first. Dismissing hides the
  banner until a newer release appears. Admins can trigger a check (at most once a minute).
- Development builds (no `ORDLER_VERSION`) never show the banner. `UPDATE_CHECK=false`
  disables the check for air-gapped installations.

**Upgrade procedure**: take a database snapshot, change the image tag (`docker compose pull &&
docker compose up -d`, or `helm upgrade --set image.tag=X`). On start Ordler applies pending
migrations. One-click upgrades through an optional companion container are Phase 2: they need
access to the Docker socket or the Kubernetes API, which must stay an explicit opt-in.

**Data-safety guarantees** (enforced by tests in CI):

1. All pending migrations run in a single transaction; a failure leaves the schema and data
   untouched and the previous version keeps working.
2. Migrations are additive (expand/contract). `DROP`, `TRUNCATE`, `DELETE`, renames and type
   changes are rejected unless the file carries `-- ordler:allow-destructive <reason>`, and
   such removals only ship in a major release after the data has been moved.
3. For every migration, data written with the previous schema must survive it; data from the
   first release must survive an upgrade straight to the latest.
4. An image refuses to start on a schema written by a newer version (no silent downgrades);
   downgrades go through restoring the pre-upgrade snapshot.
5. With `ORDLER_MIGRATE=false`, the app refuses to start while migrations are pending.
6. Migrations run once across replicas, under a PostgreSQL advisory lock.

---

## 17. Licensing and distribution

Modelled on Wiki.js.

- **License: AGPL-3.0.** The whole product is open source; there is no license key,
  paid tier or feature gating in code. Anyone running a modified version as a network
  service must offer its source to users (AGPL §13).
- Dependencies must be AGPL-compatible (MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL, GPL-3.0);
  a license check in CI blocks incompatible ones.
- **Source**: public GitHub repository; issues, discussions and pull requests are open.
  Contributions under DCO sign-off (proposed, see §15). Repository files: `LICENSE`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (private vulnerability reporting).
- **Images**: published to GitHub Container Registry and Docker Hub on every release,
  multi-arch (amd64, arm64). Tags: exact `X.Y.Z`, rolling `X.Y` and `X`; docs recommend
  pinning a major tag rather than `latest`.
- **Helm chart**: published as an OCI artifact on GHCR and as a classic Helm repository on
  GitHub Pages.
- **Release pipeline** (GitHub Actions): tag `vX.Y.Z` → tests → build image → SBOM
  (CycloneDX) → sign image with cosign (keyless) → push to GHCR and Docker Hub → publish
  chart → GitHub Release with changelog.
- **Versioning**: SemVer. Breaking config, PostgreSQL minimum or migration changes only in a
  major release, announced in release notes with an upgrade guide.
- **Telemetry**: none. The only outbound call Ordler makes on its own is the anonymous daily
  release check (§16.5), which admins can switch off with `UPDATE_CHECK=false`.
