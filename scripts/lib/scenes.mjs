/**
 * The two scenes, in one place.
 *
 * Shared by the styling preview and the screenshot capture so that the picture in
 * the README and the thing you tune in a browser are built from the same markup.
 * Two hand-written copies of a scene would drift, and a picture that drifts from
 * the product is worse than no picture.
 *
 * The markup mirrors what `src/content/Overlay.tsx` renders. It is written by hand
 * here because the component cannot be rendered outside the extension — it wants
 * `chrome` and the page it lives in — so this file is a description of that
 * component, and it has to be kept honest by hand. The lyrics are invented, and
 * have to be: the repository must not contain real ones.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The extension's own stylesheets. The point of the whole exercise. */
export function stylesheets() {
  return {
    tokens: readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8'),
    panel: readFileSync(join(ROOT, 'src/styles/panel.css'), 'utf8'),
  };
}

/* --- Icons, copied from Overlay.tsx --------------------------------------- */

const REFRESH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M20.5 3.5v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const PIP_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="3" y="4" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/>
  <rect x="12" y="11" width="8" height="6" rx="1.6" fill="currentColor"/>
</svg>`;

const MINUS_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M6 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

/* --- The invented lyric --------------------------------------------------- */

export const LINES = [
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

export const TRACK = { title: 'Gromble Song', artist: 'The Wibbles', source: 'lrclib' };

/** Chosen so the current line sits in the middle of the visible window. */
export const CURRENT = 13;
export const PROGRESS = 0.42;

/** Five shapes the stylesheet turns into the backdrop: four blooms and a sweep. */
const PIP_BACKDROP = `<div class="lyrimusic-pip__backdrop" aria-hidden="true">
  <span></span><span></span><span></span><span></span><span class="sweep"></span>
</div>`;

const PIP_CONTROLS = `<div class="lyrimusic-pip__controls">
  <button class="lyrimusic__icon-button" type="button" title="Ask the sources again">${REFRESH_ICON}</button>
</div>`;

/**
 * The pop-out window's contents.
 *
 * The three blocks must be DIRECT children of `body.lyrimusic-pip`, with nothing
 * wrapping them — `body` is the flex column that gives the lyric list its height,
 * and its height is what makes it scroll. See `src/content/pip-window.ts`; this
 * harness has already lied once by writing a structure the app did not use.
 */
export function pipMarkup({ plain = false } = {}) {
  const lines = LINES.map((text, index) => {
    const current = !plain && index === CURRENT;
    const className = current
      ? 'lyrimusic__line is-current'
      : plain
        ? 'lyrimusic__line is-plain'
        : 'lyrimusic__line';
    const style = current ? ` style="--lyri-progress:${PROGRESS}"` : '';
    return `      <p class="${className}" data-line="${index}"${style}>${text}</p>`;
  }).join('\n');

  return `${PIP_BACKDROP}
${PIP_CONTROLS}
<div class="lyrimusic__lyrics">
${lines}
</div>`;
}

/**
 * The in-page panel, over a stand-in background.
 *
 * The background is abstract on purpose. Dressing it up as YouTube Music would
 * make a prettier picture and a dishonest one: this is the extension's panel, not
 * a screenshot of someone else's product.
 */
export function panelMarkup() {
  const lines = LINES.slice(4, 19)
    .map((text, index) => {
      const current = index === 8;
      const style = current ? ` style="--lyri-progress:${PROGRESS}"` : '';
      const className = current ? 'lyrimusic__line is-current' : 'lyrimusic__line';
      return `      <p class="${className}" data-line="${index}"${style}>${text}</p>`;
    })
    .join('\n');

  return `<div class="scene-backdrop" aria-hidden="true"></div>
  <section class="lyrimusic" aria-label="Lyrics">
    <header class="lyrimusic__header">
      <div class="lyrimusic__heading">
        <p class="lyrimusic__title">${TRACK.title}</p>
        <p class="lyrimusic__artist">${TRACK.artist}</p>
      </div>
      <span class="lyrimusic__badge">${TRACK.source}</span>
      <button class="lyrimusic__icon-button" type="button" title="Ask the sources again">${REFRESH_ICON}</button>
      <button class="lyrimusic__icon-button" type="button" title="Pop out">${PIP_ICON}</button>
      <button class="lyrimusic__icon-button" type="button" title="Hide">${MINUS_ICON}</button>
    </header>
    <div class="lyrimusic__lyrics">
${lines}
    </div>
    <footer class="lyrimusic__footer">
      <span>Lyrics in sync</span>
      <span class="lyrimusic__offset">
        <button type="button" title="Lyrics 250 ms earlier">−</button>
        <button type="button" title="Lyrics 250 ms later">+</button>
      </span>
    </footer>
  </section>`;
}
