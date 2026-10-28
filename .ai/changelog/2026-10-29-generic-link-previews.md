# Generic link previews for messengers

- Date: 2026-10-29
- Area: api
- Spec: §7.1 (Generic link previews)

## Summary

Links to Ordler pasted into Teams, WhatsApp, Telegram and similar apps now show a preview card.
Crawlers are anonymous, so the card carries only the identifier from the URL, the company name
and the logo, in the workspace language.

## Changes

- `apps/api/src/http/link-preview.ts` — preview text per path (issue, request, other) in en/ru/de/az, Open Graph and Twitter card tags, company name cached for a minute.
- `apps/api/src/http/web-assets.ts` — the app shell gets preview tags once setup is complete; a failed lookup serves the plain shell.
- `apps/api/src/main.ts` — wires the preview with the configured base URL.
- `docs/SPEC.md` — describes generic previews next to Slack unfurls.

## Tests

- `apps/api/src/http/link-preview.test.ts` — identifiers only, no content; fallback card; every locale; HTML escaping; cache before and after setup.
- `apps/api/src/http/web-assets.test.ts` — tags only after setup; plain shell when the lookup fails.

## Notes

Previews appear only when the messenger's servers can reach the Ordler URL. Rich previews with
titles and status come with the Slack app (Phase 2) and Teams (Phase 3).
