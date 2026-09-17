/**
 * The shared vocabulary of the extension. Everything else imports from here.
 *
 * These are plain values with no behaviour and no browser dependencies, so
 * they can be constructed in a test without a DOM and without `chrome`.
 */

/**
 * A source of lyrics. One module per id, registered in `lib/providers`.
 *
 * This is the vocabulary, not the set of live sources: `genius` is named here
 * because `LyricsProvider.id` has to be able to type it, while `genius` is
 * deliberately absent from the registry in `lib/providers/index.ts` and from
 * the manifest's `host_permissions`. Nothing iterates this union to build the
 * UI — the popup iterates the registry — so naming a source here starts nothing.
 * See the note at the top of `lib/providers/genius.ts`.
 */
export type SourceId = 'lrclib' | 'lyricsovh' | 'kugou' | 'netease' | 'genius';

/**
 * Whether a set of lines carries timing.
 *
 * `synced` lines each have a real `timeMs` and the Lyric Clock can follow
 * them. `plain` lines all carry `0` and are meant to be read top to bottom —
 * they are still worth showing, but nothing can be highlighted.
 */
export type LyricsKind = 'synced' | 'plain';

export interface LyricLine {
  /** Start of the line, in milliseconds from the start of the track. */
  readonly timeMs: number;
  readonly text: string;
}

export interface Lyrics {
  readonly sourceId: SourceId;
  readonly kind: LyricsKind;
  readonly lines: readonly LyricLine[];
}

/**
 * The identity of a recording, as far as a provider is concerned.
 *
 * Deliberately one value rather than four positional arguments: every
 * provider takes the same thing, and adding a field later touches this type
 * instead of every provider signature and every call site.
 *
 * `title` and `artist` arrive already cleaned for searching — the YouTube
 * title is not the name anyone catalogued. See `lib/query.ts`.
 */
export interface TrackQuery {
  readonly videoId: string;
  /** Search-ready title, without "Official Video" and friends. */
  readonly title: string;
  /** Search-ready artist. */
  readonly artist: string;
  readonly album: string | null;
  readonly durationMs: number;
  /** Null unless a downloaded file or a previous lookup supplied one. */
  readonly isrc: string | null;
}

/**
 * What is playing, without the playback position.
 *
 * The position is deliberately not here: it changes every frame, and a value
 * that changes every frame does not belong in an identity. The Lyric Clock
 * reads position separately.
 */
export interface TrackMetadata {
  readonly videoId: string;
  /** The raw title as the page reports it, uncleaned. */
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly durationMs: number;
}

/**
 * The seam between the extension and YouTube Music.
 *
 * Two adapters implement this — the Media Session and the page DOM — and the
 * seam exists precisely so that the fragile knowledge of YouTube's markup
 * lives behind one interface with a fake for tests.
 */
export interface NowPlayingSource {
  /** Metadata for whatever is playing, or null when nothing is. */
  read(): TrackMetadata | null;
  /** Playback position in milliseconds, or null when nothing is playing. */
  positionMs(): number | null;
  /**
   * Calls back when the track changes — not on every position tick.
   * Returns an unsubscribe function.
   */
  watch(onChange: (track: TrackMetadata | null) => void): () => void;
}
