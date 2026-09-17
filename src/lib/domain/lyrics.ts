/**
 * Turning what a provider returns into `Lyrics`.
 *
 * The one place that knows the LRC dialect, so no provider has to. Providers
 * hand over raw text and get back something the clock can follow, or null
 * when the text held nothing usable.
 */

import type { LyricLine, Lyrics, SourceId } from './types';

/** `[mm:ss]`, `[mm:ss.xx]` and `[mm:ss.xxx]`, only at the start of a line. */
const LEADING_TIMESTAMP = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/;

/**
 * A bare `[a-z:]` tag is metadata — `[ti:...]`, `[ar:...]`, `[offset:...]` —
 * and is dropped rather than read as a line of lyrics.
 */
function toMillis(minutes: string, seconds: string, fraction: string | undefined): number {
  const millis =
    fraction === undefined
      ? 0
      : fraction.length === 1
        ? Number(fraction) * 100
        : fraction.length === 2
          ? Number(fraction) * 10
          : Number(fraction.slice(0, 3));
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + millis;
}

/**
 * Parse LRC into lines, sorted by time.
 *
 * Handles several timestamps on one line (`[00:12.00][01:20.00]chorus`), the
 * one-, two- and three-digit fractions that different writers emit, and
 * metadata tags. Lines with no text — the usual way to mark an instrumental
 * gap — are dropped, since there is nothing to draw.
 *
 * Returns an empty array for text that held no timed lines at all.
 */
export function parseLrc(raw: string): LyricLine[] {
  const out: LyricLine[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const stamps: number[] = [];
    let rest = line;
    for (let match = LEADING_TIMESTAMP.exec(rest); match !== null; match = LEADING_TIMESTAMP.exec(rest)) {
      stamps.push(toMillis(match[1] ?? '0', match[2] ?? '0', match[3]));
      rest = rest.slice(match[0].length);
    }

    // No leading timestamp: a metadata tag or an untimed credit line.
    if (stamps.length === 0) continue;

    const text = rest.trim();
    if (text === '') continue;

    for (const timeMs of stamps) out.push({ timeMs, text });
  }

  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

/** Split plain text into untimed lines. Used by providers that have no clock. */
export function plainLines(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ timeMs: 0, text: line }));
}

/** `Lyrics` from raw LRC, or null when nothing timed could be read. */
export function fromLrc(sourceId: SourceId, raw: string): Lyrics | null {
  const lines = parseLrc(raw);
  return lines.length === 0 ? null : { sourceId, kind: 'synced', lines };
}

/** `Lyrics` from plain text, or null when it was empty. */
export function fromPlainText(sourceId: SourceId, text: string): Lyrics | null {
  const lines = plainLines(text);
  return lines.length === 0 ? null : { sourceId, kind: 'plain', lines };
}

/**
 * Whether anything can be followed.
 *
 * `kind` is the provider's promise and it is almost enough, but not quite: a set
 * of lines that all carry a timestamp of zero cannot be followed either. Every
 * line would compare as "already started", so a binary search for the current
 * line finds the LAST of them — and a clock that reports the final line of the
 * song as current does not fail quietly, it pins the view to the bottom and the
 * reader cannot scroll back up. Asking both questions is cheap insurance against
 * a provider that labels its output wrongly.
 */
export function hasTiming(lyrics: Lyrics): boolean {
  return lyrics.kind === 'synced' && lyrics.lines.some((line) => line.timeMs > 0);
}
