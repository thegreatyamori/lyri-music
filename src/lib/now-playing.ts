import type { NowPlayingSource, TrackMetadata } from './domain/types';

function safeRead(source: NowPlayingSource): TrackMetadata | null {
  try {
    return source.read();
  } catch {
    return null;
  }
}

export function firstAvailable(
  sources: readonly NowPlayingSource[],
): NowPlayingSource {
  return {
    read(): TrackMetadata | null {
      for (const source of sources) {
        const track = safeRead(source);
        if (track !== null) {
          return track;
        }
      }
      return null;
    },

    positionMs(): number | null {
      for (const source of sources) {
        const track = safeRead(source);
        if (track !== null) {
          try {
            return source.positionMs();
          } catch {
            return null;
          }
        }
      }
      return null;
    },

    watch(onChange: (track: TrackMetadata | null) => void): () => void {
      if (sources.length === 0) {
        return () => undefined;
      }

      const latest: Array<TrackMetadata | null> = sources.map((source) =>
        safeRead(source),
      );
      let current = firstNonNull(latest);
      let active = true;

      onChange(current);

      const unsubscriptions: Array<() => void> = [];
      sources.forEach((source, index) => {
        try {
          const unsubscribe = source.watch((track) => {
            if (!active) {
              return;
            }
            latest[index] = track;
            const next = firstNonNull(latest);
            if (isNoChange(current, next)) {
              current = next;
              return;
            }
            current = next;
            onChange(next);
          });
          unsubscriptions.push(unsubscribe);
        } catch {
          // One broken adapter must not prevent the remaining sources.
        }
      });

      return () => {
        active = false;
        for (const unsubscribe of unsubscriptions) {
          try {
            unsubscribe();
          } catch {
            // Unsubscription is best effort for defensive composition.
          }
        }
      };
    },
  };
}

function firstNonNull(
  tracks: readonly (TrackMetadata | null)[],
): TrackMetadata | null {
  for (const track of tracks) {
    if (track !== null) {
      return track;
    }
  }
  return null;
}

/**
 * Whether an update carries nothing new.
 *
 * The identity is the WHOLE image — id, title, artist, album — and comparing
 * only the id was a real bug with a nasty shape. A track's id comes from the
 * url and is known the instant you change song, while the title and artist come
 * from the page and lag behind it. So the first report after a change pairs the
 * NEW id with the PREVIOUS song's name, and a lookup made then answers the wrong
 * question. If the correction that follows counts as "nothing changed" — same
 * id, after all — the panel never asks again and shows the old song's words
 * until the cache entry expires.
 *
 * A duration *arriving* is a change for the same reason: the first lookup may
 * have gone out before the video element knew its length. A duration merely
 * changing value is not, because nothing upstream reports a live length.
 */
function isNoChange(first: TrackMetadata | null, second: TrackMetadata | null): boolean {
  if (first === null) return second === null;
  if (second === null) return false;

  if (first.videoId !== second.videoId) return false;
  if (first.title !== second.title) return false;
  if (first.artist !== second.artist) return false;
  if (first.album !== second.album) return false;

  return !(first.durationMs <= 0 && second.durationMs > 0);
}
