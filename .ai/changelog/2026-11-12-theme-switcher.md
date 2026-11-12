# Theme switcher (System / Light / Dark)

- Date: 2026-11-12
- Area: web, api, shared
- Spec: §5.4

## Summary

Members choose the app theme in Settings → Appearance instead of always following the OS. The
choice is stored on the member, so it follows them across devices; diagrams stay light in
every theme.

## Changes

- packages/shared/src/preferences.ts — `THEMES`, `isTheme`, `mePreferencesSchema`; `MeResponse.member.theme`.
- apps/api — `members.theme` column (migration 0032, additive, null = system); `PATCH /api/me/preferences`; `/api/me` returns the theme.
- apps/web/src/theme/theme.ts — applies `data-theme` on `<html>` before the first render, caches the choice in localStorage, follows the OS only on "system".
- apps/web/src/styles.css — dark tokens and Tailwind `dark:` variant keyed on `data-theme`; light sheet behind Mermaid diagrams.
- apps/web/src/settings/AppearancePage.tsx — new settings tab; AuthGate applies the server-side choice after sign-in.
- Whiteboards and Mermaid always use their light theme.
- Locales en/ru/de/az — `appearance.*`.

## Tests

- packages/shared/src/preferences.test.ts — accepted and rejected themes.
- apps/api/src/auth/auth.http.test.ts — theme saved and returned for the member; invalid theme and anonymous change refused.
- apps/web/src/theme/theme.test.ts — explicit choice overrides the OS, "system" follows it, storage fallback.
- apps/web/src/settings/AppearancePage.test.tsx — instant switch and save; rollback when saving fails.

## Notes

Migration 0032 adds one nullable column.
