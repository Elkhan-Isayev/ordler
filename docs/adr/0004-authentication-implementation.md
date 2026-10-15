# ADR 0004 — Authentication implementation

- Status: Accepted
- Date: 2026-10-15

## Context

Phase 1 needs password, email OTP and Google sign-in, a first-run setup wizard and
server-side sessions, on-premises and behind a single Docker image. Every extra native
dependency or service makes installs harder.

## Decision

- **Sessions**: opaque 256-bit random tokens in an `HttpOnly; SameSite=Lax` cookie
  (`Secure` when `BASE_URL` is HTTPS). Only the SHA-256 of a token is stored, in `sessions`.
  No JWTs: revocation, deactivation and sign-out take effect immediately, and no signing
  secret has to be managed.
- **Passwords**: Argon2id from Node's built-in `crypto.argon2` (Node 24), PHC string format,
  OWASP baseline parameters; hashes made with weaker parameters are upgraded on sign-in.
  No native npm module.
- **Secrets at rest**: AES-256-GCM (`SecretBox`) with `ENCRYPTION_KEY`, bound to their
  purpose via associated data. Also seals the Google OAuth state cookie, so no table is
  needed for in-flight OAuth flows.
- **Google**: OpenID Connect authorization code flow with PKCE, state and nonce; ID tokens
  verified with `jose` (MIT) against Google's JWKS. Identities link to existing members only
  through a verified email.
- **Email**: `nodemailer` (MIT) with SMTP from env until the admin mail settings UI exists.
  Email copy uses ICU MessageFormat in all four locales.
- **CSRF**: SameSite=Lax cookies plus an `Origin` check on state-changing requests.
- **Brute force**: OTP attempts are capped in the database (5 per code); sign-in endpoints
  have an in-memory per-replica rate limiter.
- **Tests**: PGlite (`@electric-sql/pglite`, Apache-2.0) — real PostgreSQL 18 compiled to
  WASM, in-process — runs migrations and every database test without Docker, locally and in
  CI. Testcontainers remains the plan for network/TLS-level integration tests.

## Consequences

- One database round-trip per authenticated request to resolve the session; acceptable for
  the target scale, cacheable later.
- The rate limiter is per replica; a shared PostgreSQL-backed limiter can replace it if
  needed.
- Rotating `ENCRYPTION_KEY` makes stored OAuth/SMTP secrets unreadable; the admin re-enters
  them (documented in SPEC §16.2).
- Development needs `BASE_URL` set to the URL the browser uses (e.g. the Vite dev server),
  so the Origin check and OAuth redirects match.
