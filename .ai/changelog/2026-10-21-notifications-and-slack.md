# Inbox, email notifications and Slack channels

- Date: 2026-10-21
- Area: api, web, shared
- Spec: §7, §7.1; MVP criterion 14

## Summary

Members get an Inbox with unread and approval badges that update live, and emails with a
deep link for assignments, approvals and request outcomes. Team managers connect Slack
channels through incoming webhooks; issue and request events post Block Kit messages with an
"Open in Ordler" button.

## Changes

- `apps/api/drizzle/0010_notifications_and_slack.sql` — `notifications` and
  `chat_subscriptions` tables (additive).
- `apps/api/src/notifications/notification.service.ts` — Inbox rows, counts (unread and
  approvals waiting for me), mark read/unread, background emails with only a deep link.
- `apps/api/src/notifications/slack.service.ts` — per-team subscriptions with the webhook
  URL sealed at rest and never returned or audited (host only), test message, retries with
  429 `Retry-After`, no retry on 4xx.
- `apps/api/src/notifications/notifications.controller.ts` — `GET /api/me/notifications`,
  `GET /api/me/counts`, `POST /api/me/notifications/mark`, `/api/integrations/slack` CRUD and
  test.
- Issue and request services notify assignees, watchers, approvers and requesters and post
  to team channels; requests publish `request.changed`; realtime gains personal
  `member:<id>` topics (own id only) with `inbox.changed`.
- Web: `/inbox`, live sidebar badges, request page refreshes on `request.changed`, Admin →
  Integrations (Slack); i18n en/ru/de/az; email templates in all four locales.

## Tests

- `api/src/notifications/notifications.http.test.ts` — Inbox, deep-link email, watchers,
  mark own only, Block Kit and escaping, event filter, URL never in responses or audit,
  team.update allowed/denied, 429 retry and 4xx give-up.
- `api/src/requests/requests.http.test.ts` — `request.changed`, approval counter, Slack
  request events without form answers.
- `api/src/realtime/realtime.http.test.ts` — member topics: own allowed, others denied.
- `api/src/mail/templates.test.ts` — notification emails in every locale.
- `web/src/notifications/InboxPage.test.tsx`, `web/src/admin/IntegrationsSection.test.tsx`,
  `web/src/App.test.tsx` — Inbox, Slack admin, live badges.

## Notes

Slack interactive bot (level 2) and personal DMs are out of MVP scope.

Team Leads open Slack settings from their team in the sidebar (`/teams/KEY/integrations`);
`GET /api/me` marks teams the member manages (`manage: true`, from `team.update`).
