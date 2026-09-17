/**
 * The message contract between the content script and the background module.
 *
 * All network access lives in the background, because a content script's
 * `fetch` is subject to the page's CORS while the background module's is not.
 * That makes this file the only thing the two halves agree on, so it is worth
 * keeping small and explicit.
 *
 * The content script sends what the page reports — raw metadata. Turning that
 * into a search-ready `TrackQuery` is the background's job, because that is
 * where the settings and the query cleaner already are.
 */

import type { Lyrics, SourceId, TrackMetadata } from './domain/types';

export interface LyricsForTrack {
  readonly type: 'lyrics/for-track';
  readonly track: TrackMetadata;
  /**
   * Ask again even if this track is already in the cache.
   *
   * Required rather than optional, so that every caller has to say which it
   * means. A cached miss is indistinguishable from "no lyrics exist" in the
   * panel, and the only way out of one is to say so deliberately.
   */
  readonly force: boolean;
}

export interface SettingsGet {
  readonly type: 'settings/get';
}

export interface SettingsSet {
  readonly type: 'settings/set';
  readonly enabled: readonly SourceId[];
}

export type Request = LyricsForTrack | SettingsGet | SettingsSet;

export interface LyricsAnswer {
  readonly type: 'lyrics/answer';
  readonly videoId: string;
  /** Null means: asked, and nobody had it. Not the same as "not asked yet". */
  readonly lyrics: Lyrics | null;
  readonly sourceId: SourceId | null;
}

export interface SettingsAnswer {
  readonly type: 'settings/answer';
  readonly enabled: readonly SourceId[];
}

export type Response = LyricsAnswer | SettingsAnswer;

export function isRequest(value: unknown): value is Request {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'lyrics/for-track' || type === 'settings/get' || type === 'settings/set';
}
