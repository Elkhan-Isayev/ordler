# ADR 0012 — Email-in over IMAP

- Status: Accepted
- Date: 2026-11-01

## Context

SPEC §7 asks for email-in: a member emails a department address and gets a request. Ordler
ships on-premises with PostgreSQL as its only required service (ADR 0002). Companies already
run a mail server (Exchange, Microsoft 365, Google Workspace, Postfix/Dovecot) and rarely let
an application receive SMTP from the internet or add a mail transfer agent next to it.

## Decision

- **Poll one IMAP mailbox** (e.g. `ordler@company.com`) from the worker every minute. The
  company points request type addresses (`it-help@…`, `hr@…`) at that mailbox as aliases or
  forwards; routing uses `To`, `Cc`, `Delivered-To` and `X-Original-To`. No inbound port, no
  new service.
- **Libraries**: `imapflow` (MIT) for IMAP and `mailparser` (MIT) for MIME, both from the
  Nodemailer project Ordler already uses for SMTP. Pinned exact versions at least two weeks
  old.
- **Exactly once per Message-ID**: a row in `inbound_emails` is inserted before anything else
  (`ON CONFLICT DO NOTHING`), so several workers, or a retry after a crash, never create two
  requests. A message is flagged `\Seen` only after its outcome is stored.
- **Same rules as the portal**: the sender must be an active member and the request is
  submitted through `RequestService.submit` as that member (`via: email`), so permissions,
  forms, approvals, SLA, notifications and webhooks behave the same. A type with required form
  fields cannot be filled from an email; the sender gets a reply with the portal link.
- **No backscatter, no loops**: strangers and unknown addresses get no reply; messages marked
  `Auto-Submitted`, `Precedence: bulk/list/junk` or from bounce addresses are ignored; Ordler's
  own replies carry `Auto-Submitted: auto-replied` and thread with `In-Reply-To`.
- **Attachments** are stored with the receiving team (ADR 0008) and linked from the
  description; files above `ATTACHMENT_MAX_MB` are listed by name only.
- **Settings** live in `inbox_settings` (password sealed, write-only, audited), managed under
  `mail.manage` next to SMTP.

## Consequences

- Up to a minute of delay; IMAP IDLE could shorten it later without changing the model.
- `From` can be forged on mail servers without DMARC enforcement. Approvals still need a
  signed-in human (SPEC §6.3) and the real member receives the confirmation, so a forged
  request is visible, but admins should only enable email-in on a mailbox their mail server
  protects.
- Replies to the confirmation do not become comments yet; that needs reply-address tokens.
