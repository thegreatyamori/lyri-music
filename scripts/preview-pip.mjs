#!/usr/bin/env node
/**
 * Opens the PiP window's styling in a browser, without building or reloading the
 * extension.
 *
 * Tuning this window is a visual loop, and going through `pnpm build` and a
 * reload of the extension for every change to a font size is a bad one. This
 * renders the real `tokens.css` and `panel.css` against the same markup the PiP
 * window builds, at the size the window is actually opened at, in a scratch
 * directory — nothing here is part of the extension and nothing reaches `dist/`.
 *
 * The lyrics are invented, deliberately: this is a styling harness, and the
 * repository must not contain real ones.
 *
 *   node scripts/preview-pip.mjs [--no-open]
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(tmpdir(), 'lyri-pip-preview');

/** The size the panel asks for in `openPip`. */
const WIDTH = 360;
const HEIGHT = 520;

/** Nonsense on purpose. */
const LINES = [
  'zorblat',
  'the wibbles are here',
  'quenk',
  'flimbo and gromble',
  'nax',
  'blorp skree',
  'tum tak',
  'glim',
  'the wibbles again',
  'snerp',
  'worf',
  'klimbo',
  'zab',
  'the long invented line that wraps, to show how a two line entry stays centred',
  'quenk reprise',
  'flimbo',
  'nax nax',
  'blorp',
  'skree',
  'tum',
  'tak',
];

/** Chosen so the line is in the middle of the visible window. */
const CURRENT = 13;
const PROGRESS = 0.42;

const tokens = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');
const panel = readFileSync(join(ROOT, 'src/styles/panel.css'), 'utf8');

const lines = LINES.map((text, index) => {
  const current = index === CURRENT;
  const className = current ? 'lyrimusic__line is-current' : 'lyrimusic__line';
  const style = current ? ` style="--lyri-progress:${PROGRESS}"` : '';
  return `      <p class="${className}" data-line="${index}"${style}>${text}</p>`;
}).join('\n');

mkdirSync(OUT, { recursive: true });

writeFileSync(
  join(OUT, 'inner.html'),
  `<!doctype html>
<html>
  <head><meta charset="utf-8" /><style>
${tokens}
${panel}
  </style></head>
  <body class="lyrimusic-pip">
    <div class="lyrimusic-pip__backdrop" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span class="sweep"></span>
    </div>
    <div class="lyrimusic-pip__controls">
      <button class="lyrimusic__icon-button" type="button" title="Ask the sources again" aria-label="Ask the sources again">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path d="M20.5 3.5v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
    <div class="lyrimusic__lyrics">
${lines}
    </div>
  </body>
</html>
`,
);

writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>LyriMusic — PiP preview</title><style>
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
    .note { max-width: 270px; }
    .note h1 { font-size: 14px; margin: 0 0 10px; color: #e9e1ea; }
    .note p { margin: 0 0 10px; }
    code { color: #d0bcff; }
  </style></head>
  <body>
    <div class="frame"><iframe src="inner.html"></iframe></div>
    <div class="note">
      <h1>PiP preview</h1>
      <p>The real <code>tokens.css</code> and <code>panel.css</code>, at ${WIDTH}×${HEIGHT} — the size
      the window is actually opened at.</p>
      <p>Invented lyrics. Styling only.</p>
    </div>
  </body>
</html>
`,
);

const indexPath = join(OUT, 'index.html');
console.log(`wrote ${indexPath}`);

if (!process.argv.includes('--no-open')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    execFileSync(opener, [indexPath], { stdio: 'inherit' });
  } catch {
    console.log(`could not open a browser; open ${indexPath} yourself`);
  }
}
