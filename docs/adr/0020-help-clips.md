# ADR 0020 — Help page with recorded how-to clips

- Status: Accepted
- Date: 2026-11-25

## Context

New members ask the same questions: how to send a request to another department, how to
approve, how to write a wiki page or draw a diagram. Written guides go stale with every UI
change and have to be translated into four languages. Ordler is on-premises (ADR 0002), often
without internet access, so help cannot live on an external site or a video host.

## Decision

- **A Help page** (`/help`, in the sidebar under Approvals) shows one card per task: a title
  through i18n and a short silent screen recording. The recording carries the explanation, so
  the page needs no translated prose. Topics are listed in `apps/web/src/help/topics.ts`;
  `/help#<topic>` links to one, so screens can later point to the clip for their task.
- **Clips are WebM (VP9), not GIF.** They are several times smaller at better quality, loop
  silently like a GIF (`autoplay muted loop`) and still offer pause and fullscreen.
- **Clips ship in the image** from `apps/web/public/help`, so they work offline and match the
  installed version.
- **Clips are recorded by a script, not by hand.** `scripts/help-clips/record.sh` starts a
  throwaway instance on a fresh database, seeds a fictional demo workspace through the public
  API and drives Chromium with **Playwright** (Apache-2.0, a root dev dependency only, never in
  the image). An injected cursor shows where the mouse moves and clicks; ffmpeg trims the page
  load and re-encodes the result. Re-running the script after a UI change refreshes every clip.
- Clips record the English UI. Per-locale clips can be added later by recording each scenario
  with another locale.

## Consequences

- Each clip adds roughly 200–300 KB to the image.
- A clip scenario breaks when the UI it drives changes; the script fails loudly and saves a
  screenshot of the step it could not perform, which is the cue to update the scenario.
- Topics without a clip yet show a "coming soon" placeholder.
