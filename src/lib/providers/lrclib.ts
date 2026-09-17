import { fromLrc, fromPlainText } from '../domain/lyrics';
import type { Lyrics, TrackQuery } from '../domain/types';
import { namesAgree } from '../name-match';
import { titleVariants } from '../query';
import type { LyricsProvider } from './provider';

/**
 * LRCLIB asks clients to identify themselves.
 *
 * This cannot actually be honoured from a browser: `User-Agent` is a forbidden
 * header name and `fetch` drops it without complaint, so in production the
 * request carries the browser's own UA. It is kept because the intent is worth
 * recording and because it does take effect anywhere this module is run outside
 * a browser — but nobody should read this line and believe it is working.
 *
 * Setting it for real would mean a `declarativeNetRequest` rule, which is a
 * permission this extension does not otherwise need, for a courtesy header.
 * Not worth it; recorded here so the next reader does not re-derive it.
 */
const USER_AGENT = 'LyriMusic/0.1 (https://github.com/lyrimusic)';
const GET_URL = 'https://lrclib.net/api/get';
const SEARCH_URL = 'https://lrclib.net/api/search';

/**
 * How far a candidate's length may sit from ours before it is treated as a
 * different recording.
 *
 * A flat window is wrong in both directions: five seconds is nothing on a
 * ten-minute track, where two edits differ by far more, and it is generous on a
 * ninety-second one, where it is most of a verse. The window therefore scales
 * with the track, with a floor for anything short.
 *
 * The exact endpoint is already tolerant — a query two seconds off still
 * matched — so this matters for the free-text search, which is not.
 */
const MIN_DURATION_TOLERANCE_SECONDS = 5;
const DURATION_TOLERANCE_RATIO = 0.04;

interface LrclibResult {
  readonly id: number;
  readonly duration: number;
  readonly instrumental: boolean;
  readonly trackName: string;
  readonly artistName: string;
  readonly plainLyrics: string | null;
  readonly syncedLyrics: string | null;
}

interface Wanted {
  readonly artist: string;
  readonly title: string;
  readonly durationMs: number;
}

/**
 * Lenient on purpose. A row that is missing a name, or that reports
 * `instrumental` as something other than a boolean, is still worth reading —
 * dropping candidates here is how a search that should have hit reports nothing.
 * Only the two numbers a duration match depends on are required.
 */
function toResult(value: unknown): LrclibResult | null {
  if (typeof value !== 'object' || value === null) return null;

  const row = value as Record<string, unknown>;
  const id = row['id'];
  const duration = row['duration'];
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  if (typeof duration !== 'number' || !Number.isFinite(duration)) return null;

  return {
    id,
    duration,
    instrumental: row['instrumental'] === true,
    trackName: typeof row['trackName'] === 'string' ? row['trackName'] : '',
    artistName: typeof row['artistName'] === 'string' ? row['artistName'] : '',
    plainLyrics: typeof row['plainLyrics'] === 'string' ? row['plainLyrics'] : null,
    syncedLyrics: typeof row['syncedLyrics'] === 'string' ? row['syncedLyrics'] : null,
  };
}

function lyricsFromResult(result: LrclibResult): Lyrics | null {
  if (result.instrumental) return null;
  if (result.syncedLyrics !== null && result.syncedLyrics.trim() !== '') {
    return fromLrc('lrclib', result.syncedLyrics);
  }
  if (result.plainLyrics !== null && result.plainLyrics.trim() !== '') {
    return fromPlainText('lrclib', result.plainLyrics);
  }
  return null;
}

async function request(url: string, signal: AbortSignal): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });
  } catch {
    return null;
  }
}

async function readResult(response: Response | null): Promise<LrclibResult | null> {
  if (response === null || !response.ok) return null;
  try {
    return toResult(await response.json());
  } catch {
    return null;
  }
}

/**
 * The one exact lookup.
 *
 * `album_name` is deliberately absent. A wrong album turns a hit into a 404 —
 * verified against the live service — and the album this extension has comes
 * from a byline on a web page, which is good enough to display and not good
 * enough to match on. `duration` is sent instead: it is tolerant of a second or
 * two, and it is what separates two edits of the same song.
 */
async function lookupExact(
  artist: string,
  title: string,
  durationMs: number,
  signal: AbortSignal,
): Promise<Lyrics | null> {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    duration: String(Math.round(durationMs / 1000)),
  });

  const result = await readResult(await request(`${GET_URL}?${params}`, signal));
  return result === null ? null : lyricsFromResult(result);
}

/**
 * The forgiving lookup, and the only one that survives a version suffix.
 *
 * Worth being explicit about, because it is counter-intuitive: the structured
 * `search` endpoint matches `track_name` as strictly as `/api/get` does, and
 * returns nothing at all for "Creep (Remastered)". Only the free-text `q` is
 * fuzzy — verified. So the loosest title is searched as text, and the results
 * are judged on their names because that is the only evidence they carry.
 */
async function searchFreeText(
  artist: string,
  title: string,
  durationMs: number,
  signal: AbortSignal,
): Promise<Lyrics | null> {
  const term = `${artist} ${title}`.trim();
  if (term === '') return null;

  const response = await request(`${SEARCH_URL}?${new URLSearchParams({ q: term })}`, signal);
  if (response === null || !response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(body)) return null;

  const wanted: Wanted = { artist, title, durationMs };
  const best = pickBest(
    body.map(toResult).filter((result): result is LrclibResult => result !== null),
    wanted,
  );
  return best === null ? null : lyricsFromResult(best);
}

function pickBest(results: readonly LrclibResult[], wanted: Wanted): LrclibResult | null {
  const targetSeconds = wanted.durationMs / 1000;
  const tolerance = Math.max(
    MIN_DURATION_TOLERANCE_SECONDS,
    targetSeconds * DURATION_TOLERANCE_RATIO,
  );

  let best: LrclibResult | null = null;
  let bestNameScore = 0;
  let bestDifference = Infinity;

  for (const result of results) {
    if (result.instrumental) continue;

    const difference = Math.abs(result.duration - targetSeconds);
    if (difference > tolerance) continue;

    const nameScore = scoreNames(result, wanted);
    // A free-text search returns rows whose only relation to the query is one
    // shared word, and there is no duration precise enough to overrule them.
    // The name is the only evidence there is, so a candidate that shares
    // nothing is not taken.
    if (nameScore === 0) continue;

    const better = nameScore > bestNameScore ||
      (nameScore === bestNameScore && difference < bestDifference);
    if (better) {
      best = result;
      bestNameScore = nameScore;
      bestDifference = difference;
    }
  }

  return best;
}

/** The title matters more than the artist: search ranks on it. */
function scoreNames(result: LrclibResult, wanted: Wanted): number {
  let score = 0;
  if (namesAgree(result.trackName, wanted.title)) score += 2;
  if (namesAgree(result.artistName, wanted.artist)) score += 1;
  return score;
}

/**
 * The order of attempts, and why each one is here.
 *
 *  1. The exact lookup on the title as reported. Cheapest and most precise, and
 *     correct whenever the catalogue name is the name we already have.
 *  2. The exact lookup on the loosest variant, with a version suffix, a
 *     trailing dash clause and a featured credit removed. A suffix in
 *     `track_name` is enough to turn a hit into a 404.
 *  3. The free-text search, for everything the first two were too literal for.
 *
 * At most three requests, and only on a miss — the common case still costs one.
 */
async function fetchLyrics(query: TrackQuery, signal: AbortSignal): Promise<Lyrics | null> {
  const variants = titleVariants(query.title);
  const primary = variants[0] ?? query.title;
  const loosest = variants[variants.length - 1] ?? primary;

  const exact = await lookupExact(query.artist, primary, query.durationMs, signal);
  if (exact !== null) return exact;

  if (loosest !== primary) {
    const loosened = await lookupExact(query.artist, loosest, query.durationMs, signal);
    if (loosened !== null) return loosened;
  }

  return searchFreeText(query.artist, loosest, query.durationMs, signal);
}

export const lrclib: LyricsProvider = {
  id: 'lrclib',
  label: 'LRCLIB',
  detail: 'Community database; line-synced, and the most reliable of the four',
  kind: 'synced',
  enabledByDefault: true,
  fetch: fetchLyrics,
};
