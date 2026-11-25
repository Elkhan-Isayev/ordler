// Records each Help clip in Chromium with a visible cursor, then trims the page load and
// re-encodes it small (VP9, no audio) into apps/web/public/help/<id>.webm.
// Run through record.sh; pass clip ids to record only those.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CLIPS } from './clips.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'apps/web/public/help');
const RAW = join(ROOT, '.data/help-clips/raw');
const BASE = process.env.ORDLER_URL ?? 'http://localhost:5210';
const state = JSON.parse(readFileSync(process.env.HELP_CLIPS_STATE, 'utf8'));
const SIZE = { width: 1280, height: 800 };

/** A drawn arrow that follows the real mouse and pulses on click; headless Chromium has none. */
const CURSOR = `
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: 2147483647,
    pointerEvents: 'none', transition: 'transform 120ms', transformOrigin: '4px 2px' });
  document.body.appendChild(c);
  addEventListener('mousemove', (e) => { c.style.left = e.clientX - 4 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
  addEventListener('mousedown', () => (c.style.transform = 'scale(0.8)'), true);
  addEventListener('mouseup', () => (c.style.transform = ''), true);
});`;

async function signIn(context, email) {
  const response = await context.request.post(`${BASE}/api/auth/password`, {
    data: { email, password: state.password },
    headers: { origin: BASE },
  });
  if (!response.ok()) throw new Error(`sign-in as ${email} failed: ${response.status()}`);
}

/** Human-paced input: the mouse glides to each target before acting. */
function director(page) {
  let at = { x: SIZE.width / 2, y: SIZE.height / 2 };
  const pause = (ms = 500) => page.waitForTimeout(ms);
  async function moveTo(locator) {
    await locator.waitFor({ state: 'visible' });
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const to = { x: box.x + Math.min(box.width / 2, 40), y: box.y + box.height / 2 };
    const distance = Math.hypot(to.x - at.x, to.y - at.y);
    await page.mouse.move(to.x, to.y, { steps: Math.max(10, Math.round(distance / 12)) });
    at = to;
    await pause(250);
  }
  return {
    page,
    pause,
    moveTo,
    async click(locator) {
      await moveTo(locator);
      await page.mouse.down();
      await pause(80);
      await page.mouse.up();
      await pause(600);
    },
    async type(text) {
      await page.keyboard.type(text, { delay: 55 });
      await pause(400);
    },
    async select(locator, label) {
      await moveTo(locator);
      await locator.selectOption({ label });
      await pause(600);
    },
  };
}

async function record(clip) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    locale: 'en-US',
    colorScheme: 'light',
    recordVideo: { dir: RAW, size: SIZE },
  });
  await context.addInitScript(CURSOR);
  await signIn(context, state.users[clip.user]);
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(BASE + clip.start(state));
  await page.waitForLoadState('networkidle');
  const ui = director(page);
  await page.mouse.move(SIZE.width / 2, SIZE.height / 2);
  // The clip starts on a settled page, not on the white load.
  const skip = (Date.now() - started) / 1000;
  await ui.pause(700);
  try {
    await clip.run(ui, state);
    await ui.pause(1800);
  } catch (error) {
    await page.screenshot({ path: join(RAW, `${clip.id}-failed.png`) });
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
  const raw = await page.video().path();
  const out = join(OUT, `${clip.id}.webm`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    skip.toFixed(2),
    '-i',
    raw,
    '-an',
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '36',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    out,
  ]);
  rmSync(raw);
  console.log(`recorded ${clip.id}`);
}

rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const wanted = process.argv.slice(2);
for (const clip of CLIPS.filter((c) => wanted.length === 0 || wanted.includes(c.id))) {
  await record(clip);
}
