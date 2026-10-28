# Open camelCase admin sections by URL

- Date: 2026-10-29
- Area: web
- Spec: none

## Summary

The admin route only matched lowercase section ids, so `/admin/requestTypes` fell through to the
welcome screen. The route now accepts camelCase ids.

## Changes

- `apps/web/src/App.tsx` — admin path pattern accepts upper-case letters.

## Tests

- `apps/web/src/App.test.tsx` — opening `/admin/requestTypes` shows the Request types section.

## Notes

None
