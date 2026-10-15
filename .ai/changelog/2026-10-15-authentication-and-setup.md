# Authentication and setup wizard

- Date: 2026-10-15
- Area: shared, api, web, docs
- Spec: §4, §6.3, §8.1, §8.2, §12.1, §14 (criteria 1, 7, 8), §16.2, §16.4

## Summary

First-run setup wizard, sign-in with password, email OTP and Google (OIDC), server-side
sessions, admin API for sign-in strategies, and permissions loaded from the database. The
web app now routes between setup, sign-in and the signed-in shell. Follows
[2026-10-14-monorepo-foundation](2026-10-14-monorepo-foundation.md).

## Changes

- `packages/shared` — auth schemas (setup, password, OTP, strategy updates), email-domain
  allow-list, error codes, API response types.
- `apps/api`
  - Migration `0001_auth`: `member_passwords`, `auth_strategies`, `member_identities`,
    `otp_challenges`, `sessions`.
  - Crypto: Argon2id via `node:crypto`, AES-256-GCM `SecretBox`, tokens and OTP codes.
  - Services: setup (advisory-locked, one-time), system-role sync on every start, strategies
    (encrypted secrets, lock-out protection, audit), sessions, password sign-in (decoy hash,
    rehash), email OTP (single-use, 10 min, 5 attempts, silent cooldown, self-registration),
    Google OIDC (PKCE, state, nonce, JWKS), DB access context, `/api/me` data.
  - HTTP: `/api` prefix, session cookie hook, Origin check, rate limits, domain error filter,
    controllers for setup, auth, me and admin strategies; `@Authenticated()` routes.
  - Config: `ENCRYPTION_KEY(_FILE)`, `SESSION_TTL_DAYS`, `SMTP_*`.
  - Mail: nodemailer SMTP mailer and OTP email in en/ru/de/az.
- `apps/web` — API client, setup wizard, sign-in page (strategies as configured), auth gate,
  sign-out in the sidebar, translations for all new strings.
- Docs — ADR 0004, SPEC §16.2 env table, CLAUDE.md test guidance, README dev instructions,
  Miro deployment diagram.

## Tests

- `packages/shared/src/auth.test.ts` — schemas and domain allow-list (20 tests).
- `apps/api` — crypto, config, mail templates, setup, roles sync, strategies, password,
  OTP, sessions, rate limiter, Google OIDC with locally signed tokens, DB access context,
  `/api/me`, cookies, guard and full HTTP flows (153 tests, database tests on PGlite).
- `apps/web` — API client, error mapping, setup wizard, sign-in page, auth gate including a
  regression test, app shell (61 tests).

## Notes

- Bug fixed during the change: the auth gate re-ran its bootstrap on language change and
  signed the user back in after sign-out; covered by a regression test that fails without
  the fix.
- Verified manually in a browser against a dev API on PGlite: setup wizard, reload keeps
  the session, sign-out, wrong password, password sign-in, email OTP sign-in. Google
  sign-in was not run against real Google (needs real client credentials).
- Not yet: admin UI for strategies and mail settings, member invites, local
  self-registration with email verification, TOTP 2FA, CLI recovery commands.
