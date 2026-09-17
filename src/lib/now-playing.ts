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
            if (sameVideo(current, next)) {
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

function sameVideo(
  first: TrackMetadata | null,
  second: TrackMetadata | null,
): boolean {
  return (
    first === null
      ? second === null
      : second !== null && first.videoId === second.videoId
  );
}
