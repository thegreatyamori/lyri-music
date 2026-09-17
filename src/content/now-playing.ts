import type { NowPlayingSource, TrackMetadata } from '../lib/domain/types';
import { firstAvailable } from '../lib/now-playing';

/**
 * YouTube Music's markup.
 *
 * UNVERIFIED against the live page — these are the working assumptions and they
 * need one manual check in a real browser before this is trusted. They are all
 * in this one constant precisely so that check is a single edit, and every read
 * falls through to the next candidate rather than depending on one selector
 * being right.
 */
export const NOW_PLAYING_SELECTORS = {
  title: ['ytmusic-player-bar .title'],
  byline: ['ytmusic-player-bar .byline'],
} as const;

/**
 * The byline is "Artist • Album • Year" (or "Artist • Album" with no year).
 * It is one element, so artist and album have to be separated out of it —
 * treating the whole string as the artist would make every search miss.
 */
const BYLINE_SEPARATOR = /\s*[•·|]\s*/;

function readDomText(selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text !== undefined && text !== '') return text;
  }
  return null;
}

function readBylineParts(): readonly string[] {
  const byline = readDomText(NOW_PLAYING_SELECTORS.byline);
  if (byline === null) return [];
  return byline
    .split(BYLINE_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function readVideoId(): string | null {
  try {
    return new URL(location.href).searchParams.get('v');
  } catch {
    // A malformed href is not worth an exception in a lyrics panel.
    return null;
  }
}

function readVideo(): HTMLVideoElement | null {
  return document.querySelector('video');
}

function readDurationMs(): number {
  const duration = readVideo()?.duration;
  return duration !== undefined && Number.isFinite(duration) ? duration * 1000 : 0;
}

/**
 * The position, from the element that is actually playing.
 *
 * Shared by both adapters: whichever one supplied the metadata, the playhead is
 * the same `<video>`, and two copies of this would be two chances to disagree.
 */
function readPositionMs(): number | null {
  const currentTime = readVideo()?.currentTime;
  return currentTime !== undefined && Number.isFinite(currentTime) ? currentTime * 1000 : null;
}

/**
 * The Media Session is the better source and therefore the first adapter: the
 * browser has already normalised the title and artist into the fields they are
 * supposed to be in, with none of the byline's decoration.
 */
function readMediaSession(): TrackMetadata | null {
  const metadata = navigator.mediaSession?.metadata;
  const videoId = readVideoId();
  if (metadata == null || videoId === null || metadata.title.trim() === '') return null;

  return {
    videoId,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album === '' ? null : metadata.album,
    durationMs: readDurationMs(),
  };
}

export function createMediaSessionSource(): NowPlayingSource {
  return {
    read: readMediaSession,
    positionMs: readPositionMs,
    watch: (onChange) => {
      onChange(readMediaSession());
      // MediaSession exposes no change event, so polling is the only way to
      // hear about a track change. 500 ms is below the interval at which a
      // person notices the panel lagging and far above anything that costs
      // measurable work.
      const interval = setInterval(() => onChange(readMediaSession()), 500);
      return () => clearInterval(interval);
    },
  };
}

function readDom(): TrackMetadata | null {
  const videoId = readVideoId();
  const title = readDomText(NOW_PLAYING_SELECTORS.title);
  if (videoId === null || title === null) return null;

  const byline = readBylineParts();
  return {
    videoId,
    title,
    artist: byline[0] ?? '',
    album: byline[1] ?? null,
    durationMs: readDurationMs(),
  };
}

export function createDomSource(): NowPlayingSource {
  return {
    read: readDom,
    positionMs: readPositionMs,
    watch: (onChange) => {
      onChange(readDom());

      const bar = document.querySelector('ytmusic-player-bar');
      // The observer catches a track change the moment the player bar renders
      // it; the interval is the floor, in case the bar is replaced wholesale
      // and this observer is left watching a detached element.
      const observer = bar === null ? null : new MutationObserver(() => onChange(readDom()));
      if (observer !== null && bar !== null) {
        observer.observe(bar, { childList: true, subtree: true, characterData: true });
      }

      const interval = setInterval(() => onChange(readDom()), 1000);
      return () => {
        observer?.disconnect();
        clearInterval(interval);
      };
    },
  };
}

export function createNowPlaying(): NowPlayingSource {
  return firstAvailable([createMediaSessionSource(), createDomSource()]);
}
