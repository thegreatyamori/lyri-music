#!/usr/bin/env node
/**
 * Captures the README's images.
 *
 * Renders the two scenes from the extension's own stylesheets and photographs
 * them, straight into `docs/images/`. Committed, so the README does not depend on
 * anyone running this.
 *
 * Why not a screenshot of the real thing: the panel over YouTube Music would be a
 * better picture and a dishonest one — the lyrics in it would be somebody's
 * copyrighted words, and the repository does not carry those. These are the
 * extension's real markup and real CSS with invented words in them, and the README
 * says so.
 *
 * Through CDP rather than `--screenshot`, and that is not a preference: the flag
 * silently lays the page out at a minimum width of 500 and crops the image to the
 * size it was asked for, so what came out was never what was measured. See
 * `lib/cdp.mjs` for the whole of that discovery.
 *
 *   node scripts/shots.mjs
 */

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/cdp.mjs';
import { CURRENT, panelMarkup, pipMarkup, stylesheets } from './lib/scenes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs/images');
const WORK = join(tmpdir(), 'lyri-shots');
const PORT = 9333;

const { tokens, panel } = stylesheets();

const SCENE_CSS = `
  html, body { margin: 0; }
  .scene-backdrop {
    position: fixed; inset: 0;
    background:
      radial-gradient(120% 90% at 18% 10%, #4b3a78 0%, transparent 56%),
      radial-gradient(95% 80% at 84% 92%, #1d5a63 0%, transparent 62%),
      linear-gradient(160deg, #15131b 0%, #0c0a11 100%);
  }
`;

const SHOTS = [
  {
    name: 'panel',
    // Wider than the panel needs, so it reads as sitting in a page rather than
    // floating in a void — but not much wider, or the panel is a stamp in the
    // corner of the picture.
    width: 860,
    height: 600,
    // Below 2x: this one dithers, because of the backdrop-filter and the gradient
    // under it, and dithering is the one thing PNG cannot compress.
    scale: 1.5,
    /** Which line the shot should treat as current. */
    current: 8,
    html: `<!doctype html>
<html><head><meta charset="utf-8"><style>
${tokens}
${panel}
${SCENE_CSS}
</style></head>
<body>
${panelMarkup()}
</body></html>`,
  },
  {
    name: 'pip',
    width: 360,
    height: 520,
    scale: 2,
    current: CURRENT,
    html: `<!doctype html>
<html><head><meta charset="utf-8"><style>
${tokens}
${panel}
</style></head>
<body class="lyrimusic-pip">
${pipMarkup()}
</body></html>`,
  },
];

/**
 * The app scrolls its own list to keep the current line centred. A static page
 * does not, so the shot would show the top of the song with the highlighted line
 * somewhere below the fold — a picture of the product's least interesting state.
 * This does what the app does, and for the same reason.
 */
const centringScript = (line) =>
  `<script>document.querySelector('[data-line="${line}"]')?.scrollIntoView({ block: 'center' });</script>`;

/**
 * Whether the scene laid itself out inside its window.
 *
 * The whole reason the images were wrong for an afternoon. A scene that overflows
 * horizontally is a picture of a bug, and it should fail the harness rather than
 * get committed and puzzled over.
 */
const OVERFLOW_CHECK = `(() => {
  const list = document.querySelector('.lyrimusic__lyrics');
  if (list === null) return { ok: true, note: 'no lyric list in this scene' };
  const worst = Math.max(document.body.scrollWidth, list.scrollWidth);
  return { ok: worst <= window.innerWidth, innerWidth: window.innerWidth, worst };
})()`;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await launch(PORT);
let failed = false;

try {
  for (const shot of SHOTS) {
    const page = join(WORK, `${shot.name}.html`);
    const png = join(OUT, `${shot.name}.png`);
    writeFileSync(page, shot.html.replace('</body>', `${centringScript(shot.current)}</body>`));

    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: shot.scale,
      mobile: false,
    });
    await browser.send('Page.enable');
    await browser.send('Page.navigate', { url: `file://${page}` });
    await new Promise((resolve) => setTimeout(resolve, 900));

    const checked = await browser.send('Runtime.evaluate', {
      expression: OVERFLOW_CHECK,
      returnByValue: true,
    });
    const verdict = checked?.result?.value ?? {};

    const captured = await browser.send('Page.captureScreenshot', { format: 'png' });
    const { data } = captured ?? {};
    if (typeof data !== 'string') throw new Error(`${shot.name}: no screenshot data`);
    writeFileSync(png, Buffer.from(data, 'base64'));

    const size = `${shot.width * shot.scale}x${shot.height * shot.scale}`;
    const kb = (statSync(png).size / 1024).toFixed(0);
    const flag = verdict.ok === true ? 'ok' : `OVERFLOWS (${verdict.worst} > ${verdict.innerWidth})`;
    if (verdict.ok !== true) failed = true;
    console.log(`${shot.name}.png  ${size}  ${kb} KB  layout: ${flag}`);
  }
} finally {
  browser.close();
}

// Best effort: Chrome can still be letting go of the profile it was handed, and a
// leftover temp directory is not worth failing a build over.
try {
  rmSync(WORK, { recursive: true, force: true });
} catch {
  // The OS will get it.
}

if (failed) {
  console.error('\na scene overflows its window — the picture would show a bug');
  process.exit(1);
}

console.log(`wrote ${OUT}`);
