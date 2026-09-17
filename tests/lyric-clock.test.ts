import { describe, expect, it } from 'vitest';
import { createLyricClock } from '../src/lib/lyric-clock';
import type { LyricLine } from '../src/lib/domain/types';

const lines: readonly LyricLine[] = [
  { timeMs: 1_000, text: 'zorblat' },
  { timeMs: 3_000, text: 'the wibbles' },
  { timeMs: 5_000, text: 'plim' },
];

describe('createLyricClock', () => {
  it('returns no current line before the first line', () => {
    const clock = createLyricClock(lines);

    expect(clock.indexAt(999)).toBe(-1);
    expect(clock.lineAt(999)).toBeNull();
    expect(clock.fractionAt(999)).toBe(0);
  });

  it('uses line boundaries and the preceding line between boundaries', () => {
    const clock = createLyricClock(lines);

    expect(clock.lineAt(1_000)?.text).toBe('zorblat');
    expect(clock.indexAt(2_999)).toBe(0);
    expect(clock.indexAt(3_000)).toBe(1);
  });

  it('reports and clamps progress through a line', () => {
    const clock = createLyricClock(lines);

    expect(clock.fractionAt(1_000)).toBe(0);
    expect(clock.fractionAt(2_000)).toBeCloseTo(0.5);
    expect(clock.fractionAt(4_500)).toBe(0.75);
    expect(clock.fractionAt(5_000)).toBe(1);
    expect(clock.fractionAt(9_000)).toBe(1);
  });

  it('keeps the last line at and after its start', () => {
    const clock = createLyricClock(lines);

    expect(clock.indexAt(5_000)).toBe(2);
    expect(clock.lineAt(6_000)?.text).toBe('plim');
    expect(clock.fractionAt(6_000)).toBe(1);
  });

  it('applies positive offsets later and negative offsets earlier', () => {
    const clock = createLyricClock(lines, 500);

    expect(clock.offsetMs).toBe(500);
    expect(clock.indexAt(500)).toBe(0);
    clock.setOffsetMs(-500);
    expect(clock.offsetMs).toBe(-500);
    expect(clock.indexAt(1_000)).toBe(-1);
  });

  it('rejects non-finite offsets', () => {
    expect(() => createLyricClock(lines, Number.NaN)).toThrow(RangeError);
    expect(() => createLyricClock(lines, Number.POSITIVE_INFINITY)).toThrow(RangeError);

    const clock = createLyricClock(lines);
    expect(() => clock.setOffsetMs(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it('selects the later line at identical timestamps without NaN', () => {
    const clock = createLyricClock([
      { timeMs: 1_000, text: 'zorblat' },
      { timeMs: 1_000, text: 'wibble' },
      { timeMs: 3_000, text: 'plim' },
    ]);

    expect(clock.indexAt(999)).toBe(-1);
    expect(clock.indexAt(1_000)).toBe(1);
    expect(clock.lineAt(1_000)?.text).toBe('wibble');
    expect(clock.fractionAt(1_000)).toBe(0);
  });

  it('sorts a copy without mutating the caller array', () => {
    const input: LyricLine[] = [
      { timeMs: 3_000, text: 'plim' },
      { timeMs: 1_000, text: 'zorblat' },
    ];
    const original = [...input];
    const clock = createLyricClock(input);

    expect(clock.lineAt(1_000)?.text).toBe('zorblat');
    expect(input).toEqual(original);
  });

  it('handles no lines', () => {
    const clock = createLyricClock([]);

    expect(clock.indexAt(0)).toBe(-1);
    expect(clock.lineAt(0)).toBeNull();
    expect(clock.fractionAt(0)).toBe(0);
  });

  it('looks up 100,000 lines with binary-search performance', () => {
    const manyLines = Array.from({ length: 100_000 }, (_, index) => ({
      timeMs: index * 1_000,
      text: `zorblat-${index}`,
    }));
    const clock = createLyricClock(manyLines);
    const start = performance.now();

    // Repeated lookups make a linear scan measurably slower than binary search.
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      expect(clock.indexAt(99_999_999)).toBe(99_999);
    }

    expect(performance.now() - start).toBeLessThan(100);
  });
});
