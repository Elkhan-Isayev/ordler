# ADR 0006 — First-run installer and data volume

- Status: Accepted
- Date: 2026-10-17

## Context

Companies install Ordler themselves, often by people who prefer a web form to environment
variables. They must be able to run the image with nothing but an empty PostgreSQL database
and enter its connection in the browser, the way Gitea or the Wiki.js setup page work. The
database connection cannot live in the database itself, and Kubernetes installs still need
plain environment variables.

## Decision

- **Precedence**: `DATABASE_URL` / `DB_*` variables win. Without them Ordler reads
  `database.json` from the data volume (`ORDLER_DATA_DIR`, `/data` in the image).
- **Installer**: with neither, Ordler starts a minimal installer server on the normal port. It
  serves the web app, `/healthz`, a failing `/readyz`, and two endpoints to test and save the
  connection. Saving requires a one-time install token printed in the log (or set via
  `ORDLER_INSTALL_TOKEN`), so a freshly exposed instance cannot be pointed at someone else's
  database. After a successful probe (reachable, credentials, PostgreSQL 18+, CREATE privilege)
  the settings are written atomically and the same process starts the real application, which
  creates the schema through the normal migrations.
- **Encryption key**: `ENCRYPTION_KEY` stays supported; without it a key is generated once in
  the data volume. The stored database password is sealed with it.
- **Admin → Database**: admins see the connection without secrets; Owners (`instance.manage`,
  a new permission not granted to Org Admins) may change installer-saved settings. Changes
  apply after a restart; settings from environment variables are read-only.
- **Broken saved settings**: if the saved connection stops working at start, the installer
  comes back with the reason instead of crash-looping.
- **Static web app**: the API serves the built SPA (`@fastify/static`, MIT) so one image and
  one port cover everything.

## Consequences

- Installer mode needs a persistent, writable volume and a single replica; the Helm chart uses
  environment variables when a database is configured in values and only falls back to the
  installer (with a PVC and one replica) otherwise.
- Losing the data volume without `ENCRYPTION_KEY` loses stored secrets (database password,
  SMTP, OAuth); docs ask admins to back up the volume with the database.
