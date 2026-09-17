import type { LyricLine } from './domain/types';

export interface LyricClock {
  /** Index of the current line, or -1 before the first line. */
  indexAt(positionMs: number): number;
  /** The current line, or null before the first line or with no lines. */
  lineAt(positionMs: number): LyricLine | null;
  /** Progress through the current line, in [0, 1]. */
  fractionAt(positionMs: number): number;
  readonly offsetMs: number;
  setOffsetMs(value: number): void;
}

export function createLyricClock(
  lines: readonly LyricLine[],
  offsetMs = 0,
): LyricClock {
  const sortedLines = [...lines].sort((left, right) => left.timeMs - right.timeMs);
  // A positive offset delays lyrics relative to the audio position.
  let currentOffsetMs = offsetMs;

  if (!Number.isFinite(currentOffsetMs)) {
    throw new RangeError('offsetMs must be finite');
  }

  function indexAt(positionMs: number): number {
    const effectiveTimeMs = positionMs + currentOffsetMs;
    let low = 0;
    let high = sortedLines.length - 1;
    let result = -1;

    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const line = sortedLines[middle];

      if (line === undefined) {
        break;
      }

      if (line.timeMs <= effectiveTimeMs) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return result;
  }

  return {
    indexAt,
    lineAt(positionMs) {
      const index = indexAt(positionMs);
      return index === -1 ? null : (sortedLines[index] ?? null);
    },
    fractionAt(positionMs) {
      const index = indexAt(positionMs);
      if (index === -1) {
        return 0;
      }

      const current = sortedLines[index];
      if (current === undefined) {
        return 0;
      }

      const next = sortedLines[index + 1];
      if (next === undefined || next.timeMs <= current.timeMs) {
        return next === undefined ? 1 : 0;
      }

      const effectiveTimeMs = positionMs + currentOffsetMs;
      const fraction =
        (effectiveTimeMs - current.timeMs) / (next.timeMs - current.timeMs);
      return Math.min(1, Math.max(0, fraction));
    },
    get offsetMs() {
      return currentOffsetMs;
    },
    setOffsetMs(value: number) {
      if (!Number.isFinite(value)) {
        throw new RangeError('offsetMs must be finite');
      }
      currentOffsetMs = value;
    },
  };
}
