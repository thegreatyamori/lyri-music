#!/usr/bin/env node
/**
 * Opens the pop-out window's styling in a browser, without building or reloading
 * the extension.
 *
 * Tuning this window is a visual loop, and going through `pnpm build` and a
 * reload of the extension for every change to a font size is a bad one. This
 * renders the real `tokens.css` and `panel.css` against the same markup the pop-out
 * window builds, at the size the window is actually opened at, in a scratch
 * directory — nothing here is part of the extension and nothing reaches `dist/`.
 *
 * The markup comes from `lib/scenes.mjs`, which the screenshot capture uses too,
 * so the thing you tune and the picture in the README cannot disagree.
 *
 *   node scripts/preview-pip.mjs [--no-open] [--plain]
 *
 * `--plain` renders the untimed case: no current line and no progress mark. It is
 * the case that used to pin itself to the bottom of the song, so it is worth
 * being able to look at without a build. (The pop-out carries no footer, so the
 * "text only" note that the in-page panel shows has nowhere to appear here.)
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipMarkup, stylesheets } from './lib/scenes.mjs';

const OUT = join(tmpdir(), 'lyri-pip-preview');

/** The size `openPipShell` asks for. */
const WIDTH = 360;
const HEIGHT = 520;

const plain = process.argv.includes('--plain');
const { tokens, panel } = stylesheets();

const script =
  plain || process.argv.includes('--no-scroll')
    ? ''
    : `<script>document.querySelector('.lyrimusic__line.is-current')?.scrollIntoView({ block: 'center' });</script>`;

mkdirSync(OUT, { recursive: true });

// The three blocks go straight into the body, with nothing wrapping them: `body`
// is the flex column that gives the lyric list its height, and its height is what
// makes it scroll. See `src/content/pip-window.ts`.
writeFileSync(
  join(OUT, 'inner.html'),
  `<!doctype html>
<html>
  <head><meta charset="utf-8" /><style>
${tokens}
${panel}
  </style></head>
  <body class="lyrimusic-pip">
${pipMarkup({ plain })}
${script}
  </body>
</html>
`,
);

writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>LyriMusic — pop-out preview</title><style>
    html, body { background: #151318; margin: 0; }
    body {
      display: flex; gap: 30px; align-items: center; justify-content: center;
      min-height: 100vh; color: #cbc2cc;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    .frame {
      width: ${WIDTH}px; height: ${HEIGHT}px; border-radius: 14px; overflow: hidden;
      border: 1px solid rgb(255 255 255 / 10%);
      box-shadow: 0 18px 50px rgb(0 0 0 / 55%);
    }
    iframe { width: ${WIDTH}px; height: ${HEIGHT}px; border: 0; display: block; }
    .note { max-width: 280px; }
    .note h1 { font-size: 14px; margin: 0 0 10px; color: #e9e1ea; }
    .note p { margin: 0 0 10px; }
    code { color: #d0bcff; }
  </style></head>
  <body>
    <div class="frame"><iframe src="inner.html"></iframe></div>
    <div class="note">
      <h1>Pop-out preview${plain ? ' — untimed' : ''}</h1>
      <p>The real <code>tokens.css</code> and <code>panel.css</code>, at ${WIDTH}×${HEIGHT} — the size
      the window is actually opened at.</p>
      <p>Invented lyrics. Styling only.</p>
      <p><code>pnpm shots</code> captures these into <code>docs/images/</code>.</p>
    </div>
  </body>
</html>
`,
);

const indexPath = join(OUT, 'index.html');
console.log(`wrote ${indexPath}`);

if (!process.argv.includes('--no-open')) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    execFileSync(opener, [indexPath], { stdio: 'inherit' });
  } catch {
    console.log(`could not open a browser; open ${indexPath} yourself`);
  }
}
