import { fromPlainText } from '../domain/lyrics';
import type { TrackQuery } from '../domain/types';
import { textFromDivsWith } from '../html-text';
import { namesAgree, normalizeName } from '../name-match';
import type { LyricsProvider } from './provider';

const SEARCH_URL = 'https://genius.com/api/search/song';

/**
 * Genius marks up its lyrics in `<div data-lyrics-container="true">`, and there
 * is more than one per song: the page splits the lyrics around the annotations
 * and inline adverts it injects between them. Every container is read and the
 * results are joined, which is what puts the song back together.
 */
const LYRICS_CONTAINER = 'data-lyrics-container="true"';

/**
 * Genius renders section markers as literal bracketed lines — `[Verse 1]`,
 * `[Chorus]`, `[Guitar Solo]` — because that is the convention its editors use.
 * They are structure, not words anybody sings, so they are dropped.
 */
const SECTION_HEADER = /^\[[^\]]{1,60}\]$/;

/**
 * The advert Genius splices directly into the lyrics. It is rendered inside the
 * same containers as the song, so it survives extraction and is unmistakable.
 */
const INLINE_ARTIFACT = /^you might also like[.…]?$/i;

/**
 * Genius reports no duration, so there is nothing to disambiguate a match with —
 * a name is all there is. The floor is therefore set high enough that a lucky
 * title collision alone cannot win: two weak signals are required, or one
 * strong one.
 */
const MIN_MATCH_SCORE = 3;

interface GeniusHit {
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly instrumental: boolean;
}

/**
 * Genius, scraped from its public pages.
 *
 * NOT WIRED UP, ON PURPOSE. Nothing imports this module: `genius` is absent
 * from `SourceId`, absent from the registry in `./index.ts`, and `genius.com`
 * is absent from `host_permissions` in the manifest. It therefore never runs,
 * never enters the bundle, and cannot be reached from the UI — the code is here
 * and tested, and switched off.
 *
 * Activating it means two edits, and both are required:
 *   1. add `genius` to `PROVIDERS` in `src/lib/providers/index.ts`
 *   2. add `"https://genius.com/*"` to `host_permissions` in `public/manifest.json`
 * Without (2) the request fails on permissions even if (1) is done, and the
 * source would appear in the settings list having never worked.
 *
 * `'genius'` is already named in `SourceId` in `src/lib/domain/types.ts` — that
 * is the vocabulary rather than the wiring, and nothing iterates it to decide
 * what runs. Being named there is what lets this module typecheck while it sits
 * switched off.
 *
 * It is the only source here whose response is HTML rather than JSON, and the
 * only one that has to be read rather than parsed — see `html-text.ts` for what
 * that costs. It is untimed, so it is a fallback wherever a timed source has
 * anything at all, but Genius has the widest catalogue of the four and is
 * frequently the only place an obscure track exists.
 *
 * Two things to know before switching it on: it is a scrape of a page rather
 * than an offered API, which is why it is `enabledByDefault: false` — and it
 * works from a browser only because the browser sends its own User-Agent, which
 * is the one Genius accepts. That was verified: the same request with a `curl`
 * User-Agent answers 403.
 */
export const genius: LyricsProvider = {
  id: 'genius',
  label: 'Genius',
  detail: 'Plain text, scraped from the public page; no timings',
  kind: 'plain',
  enabledByDefault: false,

  async fetch(query, signal) {
    try {
      const hit = await findHit(query, signal);
      if (hit === null) return null;

      const page = await fetch(hit.url, { signal });
      if (!page.ok) return null;

      const lines = cleanLines(textFromDivsWith(await page.text(), LYRICS_CONTAINER));
      if (lines.length === 0) return null;

      return fromPlainText('genius', lines.join('\n'));
    } catch {
      // A miss, a network failure and an abort are one thing to the lookup.
      return null;
    }
  },
};

async function findHit(query: TrackQuery, signal: AbortSignal): Promise<GeniusHit | null> {
  const term = `${query.title} ${query.artist}`.trim();
  if (term === '') return null;

  const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(term)}`, { signal });
  if (!response.ok) return null;

  return pickHit(await response.json(), query);
}

function pickHit(body: unknown, query: TrackQuery): GeniusHit | null {
  let best: GeniusHit | null = null;
  let bestScore = 0;

  for (const hit of readHits(body)) {
    // Genius flags these itself, and there are no words to show.
    if (hit.instrumental) continue;
    const score = scoreHit(hit, query);
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }

  return bestScore >= MIN_MATCH_SCORE ? best : null;
}

/**
 * Genius reports no duration, so this is a name comparison and nothing more.
 * An exact agreement on either side is worth three; a partial one, one. A
 * partial title with a partial artist therefore just clears the floor, which is
 * the weakest thing allowed through.
 */
function scoreHit(hit: GeniusHit, query: TrackQuery): number {
  const title = normalizeName(hit.title);
  const wantedTitle = normalizeName(query.title);
  const artist = normalizeName(hit.artist);
  const wantedArtist = normalizeName(query.artist);

  let score = 0;
  if (title !== '' && title === wantedTitle) score += 3;
  else if (namesAgree(hit.title, query.title)) score += 1;

  if (artist !== '' && artist === wantedArtist) score += 3;
  else if (namesAgree(hit.artist, query.artist)) score += 1;

  return score;
}

function readHits(body: unknown): GeniusHit[] {
  const sections = readArray(readRecord(body)?.['response'], 'sections');
  const hits: GeniusHit[] = [];

  for (const section of sections) {
    for (const wrapper of readArray(section, 'hits')) {
      const result = readRecord(wrapper)?.['result'];
      const hit = toHit(result);
      if (hit !== null) hits.push(hit);
    }
  }

  return hits;
}

function toHit(value: unknown): GeniusHit | null {
  const result = readRecord(value);
  if (result === null) return null;
  // The search also returns albums, artists and videos in other sections.
  if (result['_type'] !== 'song') return null;

  const url = readString(result, 'url');
  const title = readString(result, 'title');
  if (url === null || title === null) return null;

  const artist = readString(readRecord(result['primary_artist']) ?? {}, 'name') ?? '';

  return { url, title, artist, instrumental: result['instrumental'] === true };
}

function cleanLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '' && !SECTION_HEADER.test(line) && !INLINE_ARTIFACT.test(line));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown, key: string): readonly unknown[] {
  const found = readRecord(value)?.[key];
  return Array.isArray(found) ? found : [];
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const found = value[key];
  return typeof found === 'string' && found !== '' ? found : null;
}
