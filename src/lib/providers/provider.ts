/**
 * What a provider has to be.
 *
 * A provider is a module that knows one service and nothing else. It receives
 * a `TrackQuery` and either produces `Lyrics` or produces nothing; it does not
 * know about the order it is asked in, about the cache, about the other
 * providers, or about the UI.
 *
 * Adding a provider means adding a module and one row in the registry — it
 * must not mean editing the lookup.
 */

import type { Lyrics, LyricsKind, SourceId, TrackQuery } from '../domain/types';

export interface LyricsProvider {
  readonly id: SourceId;
  readonly label: string;
  /** One line for the settings list: what this source is good for. */
  readonly detail: string;
  /** What this provider can produce, at best. Used to brief the user. */
  readonly kind: LyricsKind;
  /**
   * Off by default for sources whose access is unofficial. The user opts in
   * from the settings panel, so the choice to contact them is theirs.
   */
  readonly enabledByDefault: boolean;
  /**
   * Look up lyrics for one recording.
   *
   * Returns null when this provider has nothing for the query — a miss is
   * normal and is not an error. Throws only when the caller did something
   * wrong, never to report an empty result. Must honour `signal`: every
   * provider is asked at the same time and the losers are cancelled.
   */
  fetch(query: TrackQuery, signal: AbortSignal): Promise<Lyrics | null>;
}
