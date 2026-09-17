import type { LyricsProvider } from './provider';
import { fromPlainText } from '../domain/lyrics';

const BASE = 'https://api.lyrics.ovh/v1';

/**
 * Some responses open with this courtesy line before the first real line.
 * It is not a lyric and has no place in the panel.
 */
const COURTESY_PREFIX = /^paroles de la chanson/i;

/**
 * lyrics.ovh returns untimed text and nothing else.
 *
 * That makes it the last source worth trying, not the first: it can never
 * highlight a line. It earns its place because it is an open, documented API
 * that answers for tracks the timed sources have never heard of, and because
 * something unhighlighted beats an empty panel.
 */
export const lyricsovh: LyricsProvider = {
  id: 'lyricsovh',
  label: 'lyrics.ovh',
  detail: 'Plain text only; a last resort when nothing timed is available',
  kind: 'plain',
  enabledByDefault: true,

  async fetch(query, signal) {
    const artist = query.artist.trim();
    const title = query.title.trim();
    if (artist === '' || title === '') return null;

    const url = `${BASE}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;

    try {
      const response = await fetch(url, { signal });
      if (!response.ok) return null;

      const body: unknown = await response.json();
      const text = readLyrics(body);
      if (text === null) return null;

      return fromPlainText('lyricsovh', dropCourtesyLine(text));
    } catch {
      // A miss, a network failure and an abort are all the same thing to the
      // lookup: this provider had nothing. Only a programmer error should throw.
      return null;
    }
  },
};

function readLyrics(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as { lyrics?: unknown }).lyrics;
  return typeof value === 'string' ? value : null;
}

function dropCourtesyLine(text: string): string {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return text;
  if (!COURTESY_PREFIX.test(lines[first]?.trim() ?? '')) return text;
  return lines.slice(first + 1).join('\n');
}
