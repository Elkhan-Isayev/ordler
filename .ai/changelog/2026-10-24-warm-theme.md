# Warmer, cosier interface

- Date: 2026-10-24
- Area: web
- Spec: §5.4

## Summary

The interface moves from cold blue-grey to warm graphite (dark) and paper (light) tones with
cream text, rounder corners and soft shadows. Inter is bundled with the app, the sidebar has
icons, avatars get a stable colour per person, and the issue page reads as a centred column
with its properties in a quiet card.

## Changes

- `apps/web/src/styles.css` — warm palette tokens, `--color-card`, `--shadow-card`, larger radii,
  bundled Inter Variable.
- Raised elements (panels, cards, inputs, menus, dialogs) use the card colour; board cards and
  panels get soft shadows.
- `Sidebar` icons (lucide-react), `Avatar` colours, quiet selects on the issue page.
- New dependencies: `lucide-react` (ISC), `@fontsource-variable/inter` (OFL-1.1); fonts are
  served from the image, never fetched from the internet.

## Tests

- Existing web suite; checked in the browser in light and dark themes.

## Notes

None.
