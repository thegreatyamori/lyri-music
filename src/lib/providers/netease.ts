import type { LyricsProvider } from './provider';
import { fromLrc } from '../domain/lyrics';
import type { TrackQuery } from '../domain/types';

const USER_AGENT = 'LyriMusic/0.1';
const SEARCH_ENDPOINT = 'https://music.163.com/api/search/get';
const LYRIC_ENDPOINT = 'https://music.163.com/api/song/lyric';

interface Song {
  readonly id: string | number;
  readonly duration: number;
  readonly artistNames: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toSong(value: unknown): Song | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const duration = value.duration;
  const artists = value.artists;
  if ((typeof id !== 'string' && typeof id !== 'number') || !Number.isFinite(Number(id))) return null;
  if (typeof duration !== 'number' || !Number.isFinite(duration)) return null;
  if (!Array.isArray(artists)) return null;

  const artistNames = artists
    .filter((artist): artist is Record<string, unknown> => isRecord(artist))
    .map((artist) => (typeof artist.name === 'string' ? artist.name : ''))
    .filter((name) => name !== '')
    .join(' ');
  return { id, duration, artistNames };
}

function readSongs(body: unknown): Song[] {
  if (!isRecord(body) || !isRecord(body.result) || !Array.isArray(body.result.songs)) return [];
  return body.result.songs.map(toSong).filter((song): song is Song => song !== null);
}

function readLyric(body: unknown): { lyric: string; uncollected: boolean } | null {
  if (!isRecord(body) || !isRecord(body.lrc) || typeof body.lrc.lyric !== 'string') return null;
  return {
    lyric: body.lrc.lyric,
    uncollected: body.uncollected === true,
  };
}

function hasUsableDuration(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs > 0;
}

function chooseSong(songs: readonly Song[], query: TrackQuery): Song | null {
  const first = songs[0];
  if (first === undefined) return null;
  if (!hasUsableDuration(query.durationMs)) return first;

  const wantedArtist = query.artist.trim().toLocaleLowerCase();
  const artistMatches =
    wantedArtist === ''
      ? []
      : songs.filter((song) => song.artistNames.toLocaleLowerCase().includes(wantedArtist));
  const pool = artistMatches.length > 0 ? artistMatches : songs;

  let closest: Song | undefined;
  let closestDifference = Number.POSITIVE_INFINITY;
  for (const song of pool) {
    const difference = Math.abs(song.duration - query.durationMs);
    if (difference < closestDifference) {
      closest = song;
      closestDifference = difference;
    }
  }
  return closest !== undefined && closestDifference <= 3_000 ? closest : null;
}

const CREDIT_PREFIX =
  /^(?:作词|作曲|编曲|制作人|混音|母带|lyrics by|composed by|arranged by|produced by)\s:\s/i;
const TIMESTAMP = /^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/;

function stripLeadingCredits(raw: string): string {
  const lines = raw.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    let rest = line.trim();
    let hadTimestamp = false;
    while (TIMESTAMP.test(rest)) {
      hadTimestamp = true;
      rest = rest.slice(TIMESTAMP.exec(rest)?.[0].length ?? 0);
    }
    if (!hadTimestamp || !CREDIT_PREFIX.test(rest.trim())) break;
    index += 1;
  }
  return lines.slice(index).join('\n');
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal,
  });
  if (!response.ok) return null;
  return response.json();
}

export const netease: LyricsProvider = {
  id: 'netease',
  label: 'NetEase Cloud Music',
  detail: 'Community lyrics from NetEase Cloud Music.',
  kind: 'synced',
  enabledByDefault: false,

  async fetch(query, signal) {
    try {
      const searchUrl = new URL(SEARCH_ENDPOINT);
      searchUrl.searchParams.set('s', `${query.title} ${query.artist}`);
      searchUrl.searchParams.set('type', '1');
      searchUrl.searchParams.set('limit', '10');
      searchUrl.searchParams.set('offset', '0');
      const searchBody = await fetchJson(searchUrl.toString(), signal);
      const song = chooseSong(readSongs(searchBody), query);
      if (song === null) return null;

      const lyricUrl = new URL(LYRIC_ENDPOINT);
      lyricUrl.searchParams.set('id', String(song.id));
      lyricUrl.searchParams.set('lv', '1');
      lyricUrl.searchParams.set('kv', '1');
      lyricUrl.searchParams.set('tv', '-1');
      const lyric = readLyric(await fetchJson(lyricUrl.toString(), signal));
      if (lyric === null || lyric.uncollected || lyric.lyric.trim() === '') return null;
      return fromLrc('netease', stripLeadingCredits(lyric.lyric));
    } catch {
      return null;
    }
  },
};
