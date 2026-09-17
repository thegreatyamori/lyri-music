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
 * Matching video ids is deliberately NOT enough, and getting this wrong was a
 * real bug. The metadata arrives in pieces: the title and artist are known the
 * moment a track starts, while the length only exists once the video element has
 * loaded it. A lookup that ran in between went out with no duration. If a
 * duration arriving afterwards counts as "nothing changed", the panel never asks
 * again — the track stays wordless for as long as its cached miss survives, and
 * the moment the length became known is exactly the moment the answer was
 * already on its way to being wrong.
 *
 * A re-report of the same video with the duration it already had is still not a
 * change, which is what keeps the 500 ms poll from doing anything at all.
 */
function isNoChange(first: TrackMetadata | null, second: TrackMetadata | null): boolean {
  if (first === null) return second === null;
  if (second === null) return false;
  if (first.videoId !== second.videoId) return false;

  return !(first.durationMs <= 0 && second.durationMs > 0);
}
