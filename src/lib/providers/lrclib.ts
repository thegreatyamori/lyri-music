import { fromLrc, fromPlainText } from '../domain/lyrics';
import type { Lyrics, TrackQuery } from '../domain/types';
import { namesAgree } from '../name-match';
import { titleVariants } from '../query';
import type { LyricsProvider } from './provider';

/**
 * LRCLIB requires clients to identify themselves, and names the two headers a
 * browser can actually send.
 *
 * `User-Agent` is a forbidden header name and `fetch` drops it without
 * complaint, so an extension cannot set it. LRCLIB's documentation covers
 * exactly this case and offers `X-User-Agent` and `Lrclib-Client` as the
 * alternatives; both are sent, because either one alone is enough and sending
 * both costs nothing.
 */
const CLIENT_ID = 'LyriMusic v0.1.0 (https://github.com/thegreatyamori/lyri-music)';
const CLIENT_HEADERS: Readonly<Record<string, string>> = {
  'X-User-Agent': CLIENT_ID,
  'Lrclib-Client': CLIENT_ID,
};

const GET_URL = 'https://lrclib.net/api/get';
const SEARCH_URL = 'https://lrclib.net/api/search';

/**
 * The documented bounds on `duration`. Outside them the endpoint does not
 * ignore the parameter — it answers 400 ValidationError, and the whole lookup
 * is lost to a request that could simply have left the field out.
 */
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 3600;

/**
 * How far a free-text candidate's length may sit from ours before it is treated
 * as a different recording. A flat window is wrong in both directions: five
 * seconds is nothing on a ten-minute track and most of a verse on a short one.
 * Only the free-text path uses this — the exact endpoint applies LRCLIB's own
 * ±2 s rule, and the no-duration attempt deliberately applies none.
 */
const MIN_DURATION_TOLERANCE_SECONDS = 5;
const DURATION_TOLERANCE_RATIO = 0.04;

/**
 * How long to stop asking LRCLIB after a 429 that carried no usable
 * `Retry-After`. The documented requirement is that the client MUST honour the
 * header; ignoring it may earn a temporary ban, so a default is used rather
 * than none.
 */
const DEFAULT_BACKOFF_MS = 60_000;

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
 * dropping candidates here is how a search that should have hit reports
 * nothing. Only the two numbers a duration comparison depends on are required.
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

/**
 * The request gate, and the reason it exists.
 *
 * LRCLIB is explicit that a 429 must be honoured rather than retried past, and
 * that ignoring it can earn a temporary ban. The deadline is module state rather
 * than per-call because it is a property of the connection, not of one lookup:
 * once the server has said "wait", four providers racing is no reason to ask
 * again.
 *
 * Uses `Date.now()` rather than a monotonic clock so that tests can drive it
 * with fake timers.
 */
let blockedUntilMs = 0;

/** Exposed for tests: how long the provider is holding off for, in ms. */
export function retryAfterRemainingMs(now: number): number {
  return Math.max(0, blockedUntilMs - now);
}

function readRetryAfterMs(response: Response): number {
  const header = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
  if (Number.isFinite(header) && header > 0) return header * 1000;
  return DEFAULT_BACKOFF_MS;
}

async function request(url: string, signal: AbortSignal): Promise<Response | null> {
  if (Date.now() < blockedUntilMs) {
    console.warn('[LyriMusic] lrclib: holding off, rate limited by the server');
    return null;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: CLIENT_HEADERS, signal });
  } catch {
    return null;
  }

  if (response.status === 429) {
    const waitMs = readRetryAfterMs(response);
    blockedUntilMs = Date.now() + waitMs;
    console.warn(`[LyriMusic] lrclib: 429, waiting ${Math.round(waitMs / 1000)}s as instructed`);
    return null;
  }

  return response;
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
 * `duration` only when it is within the documented range.
 *
 * A value outside it does not degrade the match — it fails the request with a
 * 400. The realistic trigger is not an exotic track but an ordinary one that
 * has just started: until the `<video>` element knows its length the duration is
 * zero, and sending that loses a lookup that would have succeeded without it.
 */
function durationParam(durationMs: number): string | null {
  const seconds = Math.round(durationMs / 1000);
  if (!Number.isFinite(seconds)) return null;
  if (seconds < MIN_DURATION_SECONDS || seconds > MAX_DURATION_SECONDS) return null;
  return String(seconds);
}

/**
 * One exact lookup.
 *
 * `album_name` is deliberately absent. The documentation recommends it and it
 * does sharpen the match, but this extension's album comes from a byline on a
 * web page — good enough to display, not good enough to match on — and a wrong
 * album turns a hit into a 404. Verified against the live service.
 *
 * `duration` is passed only when it is worth passing. See `durationParam`.
 */
async function lookupExact(
  artist: string,
  title: string,
  durationMs: number,
  signal: AbortSignal,
): Promise<Lyrics | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  const duration = durationParam(durationMs);
  if (duration !== null) params.set('duration', duration);

  const result = await readResult(await request(`${GET_URL}?${params}`, signal));
  return result === null ? null : lyricsFromResult(result);
}

/**
 * The same exact lookup with the duration left out.
 *
 * LRCLIB treats `duration` as a SELECTOR, not a filter, and reading it the other
 * way is easy — this provider did, and it cost real misses. Measured against the
 * live service: asking for 200 s returns a 199.6 s record, asking for 999 s
 * returns a 999 s one, and only an unknown *name* produces a 404. The endpoint
 * hands back whichever record is closest to the number it was given, however far
 * away that is.
 *
 * So a duration that does not correspond to the edit LRCLIB holds does not make
 * the lookup fail — it makes it silently answer with a different edit. Leaving
 * the duration out asks for the canonical record instead, which is both the
 * better default and the only usable form when the length is not known yet: a
 * track that has just started reports zero, and zero is rejected outright.
 */
async function lookupExactWithoutDuration(
  artist: string,
  title: string,
  signal: AbortSignal,
): Promise<Lyrics | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
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
    // shared word — the top hit for a plain "artist title" query is routinely a
    // user-submitted row with the query pasted into both fields. The name is
    // the only evidence there is, so a candidate that shares nothing is not
    // taken.
    if (nameScore === 0) continue;

    const better =
      nameScore > bestNameScore || (nameScore === bestNameScore && difference < bestDifference);
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
 *  1. Exact, with the duration. Picks the edit whose length matches what is
 *     playing, which is the right answer when LRCLIB holds that edit.
 *  2. Exact, WITHOUT the duration. Asks for the canonical record instead — the
 *     better default, and the only form that works when the length is not known
 *     yet.
 *  3. Exact without duration, on the loosest title. A version suffix in
 *     `track_name` is on its own enough to produce a 404.
 *  4. Free text, for everything the first three were too literal for.
 *
 * Four requests at worst, all sequential, and only on a miss — the common case
 * still costs one, and the second attempt costs nothing when the first hits.
 */
async function fetchLyrics(query: TrackQuery, signal: AbortSignal): Promise<Lyrics | null> {
  const variants = titleVariants(query.title);
  const primary = variants[0] ?? query.title;
  const loosest = variants[variants.length - 1] ?? primary;

  if (durationParam(query.durationMs) !== null) {
    const precise = await lookupExact(query.artist, primary, query.durationMs, signal);
    if (precise !== null) return precise;
  }

  const byName = await lookupExactWithoutDuration(query.artist, primary, signal);
  if (byName !== null) return byName;

  if (loosest !== primary) {
    const loosened = await lookupExactWithoutDuration(query.artist, loosest, signal);
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
