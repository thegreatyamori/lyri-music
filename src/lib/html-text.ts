/**
 * Turning a scraped HTML fragment into text, without a DOM.
 *
 * A Manifest V3 service worker has no `document` and no `DOMParser`, so the
 * ordinary way of reading a page is unavailable — and the network has to happen
 * in the worker, because a content script's `fetch` is bound by the page's CORS.
 * This is the smallest thing that does the job for the one shape that matters
 * here: a run of `<div>` elements whose lines are separated by `<br>`.
 *
 * It is deliberately NOT a general HTML parser, and it should not be mistaken
 * for one. The tag stripping is a regex; the only structural understanding it
 * has is the balanced-`<div>` scan, which exists because Genius nests divs
 * inside the containers it uses for lyrics, so the first `</div>` is the wrong
 * one and a naive slice truncates the song at the first annotation.
 *
 * Written for the Genius provider, which is implemented but NOT wired up yet —
 * see the note in `providers/genius.ts`. Nothing else imports this today.
 */

const DIV_OPEN = /<div\b/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
/**
 * Block endings that start a new line. `div` is deliberately NOT in this list,
 * and that is the subtle part: on the pages this reads, a nested `<div>` is an
 * inline annotation wrapper sitting in the middle of a line, while the line
 * breaks come from `<br>`. Treating `</div>` as a line ending splits a lyric
 * line in two at every annotation.
 */
const BLOCK_END = /<\/(?:p|li|ul|ol|h[1-6]|blockquote)\s*>/gi;
const ANY_TAG = /<[^>]*>/g;

/**
 * The text of every `<div>` carrying `attribute`, in document order, joined by
 * newlines. Empty string when there were none.
 *
 * `attribute` is matched as a whole word inside the tag, so
 * `data-lyrics-container="true"` will not be satisfied by some other attribute
 * that merely contains the string.
 */
export function textFromDivsWith(html: string, attribute: string): string {
  // The boundaries are lookarounds rather than `\b`, because the attribute ends
  // in a quote: `"` and `>` are both non-word characters, so there is no word
  // boundary between them and a `\b` there never matches. The lookarounds also
  // reject `data-not-data-lyrics-container`, where the marker is preceded by a
  // hyphen.
  const opening = new RegExp(
    `<div[^>]*(?<![\\w-])${escapeRegExp(attribute)}(?![\\w-])[^>]*>`,
    'gi',
  );
  const parts: string[] = [];

  for (const match of html.matchAll(opening)) {
    const inner = innerOfDiv(html, (match.index ?? 0) + match[0].length);
    if (inner === null) continue;
    const text = htmlFragmentToText(inner).trim();
    if (text !== '') parts.push(text);
  }

  return parts.join('\n');
}

/**
 * The inner HTML of the div whose content starts at `contentStart`.
 *
 * Counts nested `<div>` openings against `</div>` closings so that an
 * annotation wrapper inside the lyrics does not end the slice early. Returns
 * null on an unbalanced document rather than guessing where the div ended.
 */
function innerOfDiv(html: string, contentStart: number): string | null {
  let depth = 1;
  let cursor = contentStart;

  for (;;) {
    const nextOpen = indexOfDivOpen(html, cursor);
    const nextClose = html.indexOf('</div', cursor);
    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 4;
      continue;
    }

    depth -= 1;
    if (depth === 0) return html.slice(contentStart, nextClose);
    cursor = nextClose + 5;
  }
}

function indexOfDivOpen(html: string, from: number): number {
  DIV_OPEN.lastIndex = from;
  const found = DIV_OPEN.exec(html);
  // Reset, so the shared regex cannot surprise the next caller.
  DIV_OPEN.lastIndex = 0;
  return found?.index ?? -1;
}

/**
 * Text from a fragment: `<br>` and block endings become newlines, every other
 * tag is dropped, entities are decoded.
 *
 * `<br>` is the line separator on the pages this is used against, which is why
 * it is handled before the blanket tag strip rather than after. A closing
 * `</div>` is deliberately not a line ending — see the note on `BLOCK_END`.
 */
export function htmlFragmentToText(fragment: string): string {
  return decodeEntities(
    fragment.replace(LINE_BREAK, '\n').replace(BLOCK_END, '\n').replace(ANY_TAG, ''),
  );
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Non-breaking spaces separate words that must not wrap; they are not line
  // breaks, and turning them into one would split lines that are meant to be
  // whole.
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

const ENTITY = /&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g;

export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      const decoded = safeFromCodePoint(code);
      return decoded ?? whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function safeFromCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  // Surrogates are not valid code points and would throw.
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
