import type { LyricsProvider } from './provider';
import { fromLrc, fromPlainText } from '../domain/lyrics';
import type { TrackQuery } from '../domain/types';

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

interface LrclibResult {
  readonly id: number;
  readonly duration: number;
  readonly instrumental: boolean;
  readonly plainLyrics: string | null;
  readonly syncedLyrics: string | null;
}

function isResult(value: unknown): value is LrclibResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.id === 'number' &&
    Number.isFinite(result.id) &&
    typeof result.duration === 'number' &&
    Number.isFinite(result.duration) &&
    typeof result.instrumental === 'boolean' &&
    (typeof result.plainLyrics === 'string' || result.plainLyrics === null) &&
    (typeof result.syncedLyrics === 'string' || result.syncedLyrics === null)
  );
}

function makeUrl(base: string, query: URLSearchParams): string {
  return `${base}?${query.toString()}`;
}

async function request(url: string, signal: AbortSignal): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
    });
  } catch {
    return null;
  }
}

function lyricsFromResult(result: LrclibResult) {
  if (result.instrumental) return null;
  if (result.syncedLyrics !== null && result.syncedLyrics.trim() !== '') {
    return fromLrc('lrclib', result.syncedLyrics);
  }
  if (result.plainLyrics !== null && result.plainLyrics.trim() !== '') {
    return fromPlainText('lrclib', result.plainLyrics);
  }
  return null;
}

async function readResult(response: Response): Promise<LrclibResult | null> {
  if (!response.ok) return null;
  try {
    const body: unknown = await response.json();
    return isResult(body) ? body : null;
  } catch {
    return null;
  }
}

async function search(query: TrackQuery, signal: AbortSignal): Promise<LrclibResult | null> {
  const params = new URLSearchParams({
    track_name: query.title,
    artist_name: query.artist,
  });
  const response = await request(makeUrl(SEARCH_URL, params), signal);
  if (response === null || !response.ok) return null;

  try {
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return null;
    const results = body.filter(isResult);
    let closest: LrclibResult | null = null;
    let closestDifference = Infinity;
    const durationSeconds = query.durationMs / 1000;
    for (const result of results) {
      const difference = Math.abs(result.duration - durationSeconds);
      if (difference < closestDifference) {
        closest = result;
        closestDifference = difference;
      }
    }
    return closest !== null && closestDifference <= 5 ? closest : null;
  } catch {
    return null;
  }
}

async function fetchLyrics(query: TrackQuery, signal: AbortSignal) {
  const params = new URLSearchParams({
    artist_name: query.artist,
    track_name: query.title,
    duration: String(Math.round(query.durationMs / 1000)),
  });
  if (query.album !== null && query.album !== '') params.set('album_name', query.album);

  const response = await request(makeUrl(GET_URL, params), signal);
  if (response === null) return null;
  if (response.status === 404) {
    const result = await search(query, signal);
    return result === null ? null : lyricsFromResult(result);
  }

  const result = await readResult(response);
  return result === null ? null : lyricsFromResult(result);
}

export const lrclib: LyricsProvider = {
  id: 'lrclib',
  label: 'LRCLIB',
  detail: 'Community lyrics database',
  kind: 'synced',
  enabledByDefault: true,
  fetch: fetchLyrics,
};
