# Microsoft Entra ID and generic OIDC sign-in

- Date: 2026-11-01
- Area: api, web, shared
- Spec: §8.1

## Summary

Two new sign-in strategies next to Google: Microsoft Entra ID (single tenant) and any OpenID
Connect provider found through discovery (Keycloak, Authentik, Okta, ADFS…). Both use the
authorization-code flow with PKCE, state and nonce, and follow the same self-registration,
domain and default-role rules as Google.

## Changes

- `packages/shared/src/auth.ts` — `microsoft` and `oidc` kinds, `OAUTH_STRATEGY_KINDS`,
  config fields `tenantId`, `issuerUrl`, `scopes`, `emailClaim`, `nameClaim`,
  `requireVerifiedEmail`; shared Entra tenants (`common`, `organizations`, `consumers`) and
  non-HTTPS issuers are rejected.
- `apps/api/src/auth/oidc.ts` — `OidcAuthService`: discovery (cached for an hour), token
  exchange, ID token verification against the discovered issuer and key set, identity linking.
- `apps/api/src/auth/auth.controller.ts` — `/api/auth/{microsoft,oidc}/{start,callback}`;
  the state cookie is scoped per provider.
- `apps/api/src/auth/strategies.ts` — usability rules for the new kinds; the lock-out check
  now counts only an identity from the provider that stays enabled.
- `apps/web` — sign-in buttons, admin fields (tenant, issuer, scopes, claims, verified-email
  toggle) and provider-specific redirect URI labels in all four locales.
- `docs/SPEC.md` §8.1 — how Entra and OIDC emails count as verified; group mapping deferred.

## Tests

- `oidc.test.ts`: discovery and PKCE redirect, Entra registration from `preferred_username`,
  `xms_edov: false` rejected, wrong issuer, linking by verified email then by subject, claim
  mapping, unverified email allowed only when the admin opts out, self-registration rules,
  forged state, wrong nonce, cross-provider state cookie, discovery cache.
- HTTP: Microsoft redirect and cookie path, `common` tenant refused, OIDC callback URL listed.
- Lock-out with an identity from another provider; schema tests; web sign-in and admin forms.

## Notes

No migration: strategy kinds are stored as text and new rows are created at start-up.
