/**
 * The LRC dialect, exercised on invented text.
 *
 * This file must not contain real lyrics — see CONTEXT.md. The nonsense words
 * are deliberate: they make the rule obvious to anyone reading the diff.
 */

import { describe, expect, it } from 'vitest';
import { fromLrc, fromPlainText, hasTiming, parseLrc, plainLines } from '../src/lib/domain/lyrics';

describe('parseLrc', () => {
  it('reads a plain timestamp and its text', () => {
    expect(parseLrc('[00:12.34]zorblat')).toEqual([{ timeMs: 12_340, text: 'zorblat' }]);
  });

  it('accepts one, two and three digit fractions', () => {
    expect(parseLrc('[00:01.5]a')[0]?.timeMs).toBe(1_500);
    expect(parseLrc('[00:01.50]a')[0]?.timeMs).toBe(1_500);
    expect(parseLrc('[00:01.500]a')[0]?.timeMs).toBe(1_500);
  });

  it('accepts a colon before the fraction, which some writers emit', () => {
    expect(parseLrc('[00:01:50]a')[0]?.timeMs).toBe(1_500);
  });

  it('treats a missing fraction as zero', () => {
    expect(parseLrc('[01:02]a')[0]?.timeMs).toBe(62_000);
  });

  it('repeats one line for several timestamps', () => {
    const lines = parseLrc('[00:05.00][01:30.00]flimbo');
    expect(lines).toEqual([
      { timeMs: 5_000, text: 'flimbo' },
      { timeMs: 90_000, text: 'flimbo' },
    ]);
  });

  it('drops metadata tags', () => {
    const lines = parseLrc('[ti:Gromble]\n[ar:The Wibbles]\n[offset:250]\n[00:03.00]quenk');
    expect(lines).toEqual([{ timeMs: 3_000, text: 'quenk' }]);
  });

  it('drops timed lines with no text, which mark instrumental gaps', () => {
    expect(parseLrc('[00:03.00]\n[00:04.00]blorp')).toEqual([{ timeMs: 4_000, text: 'blorp' }]);
  });

  it('sorts by time, whatever order the writer used', () => {
    const lines = parseLrc('[00:30.00]two\n[00:10.00]one\n[00:20.00]three');
    expect(lines.map((line) => line.text)).toEqual(['one', 'three', 'two']);
  });

  it('ignores blank lines and stray prose', () => {
    expect(parseLrc('\n   \nnot a timestamp\n[00:01.00]snerp\n')).toEqual([
      { timeMs: 1_000, text: 'snerp' },
    ]);
  });

  it('returns nothing when the text held no timed lines', () => {
    expect(parseLrc('no timestamps here')).toEqual([]);
    expect(parseLrc('')).toEqual([]);
  });
});

describe('plainLines', () => {
  it('keeps untimed lines and drops blanks', () => {
    expect(plainLines('  glim\n\n  blam  \n')).toEqual([
      { timeMs: 0, text: 'glim' },
      { timeMs: 0, text: 'blam' },
    ]);
  });
});

describe('fromLrc and fromPlainText', () => {
  it('builds synced lyrics tagged with their source', () => {
    expect(fromLrc('lrclib', '[00:01.00]tum')).toEqual({
      sourceId: 'lrclib',
      kind: 'synced',
      lines: [{ timeMs: 1_000, text: 'tum' }],
    });
  });

  it('builds plain lyrics tagged with their source', () => {
    expect(fromPlainText('lyricsovh', 'tum\ntak')).toEqual({
      sourceId: 'lyricsovh',
      kind: 'plain',
      lines: [
        { timeMs: 0, text: 'tum' },
        { timeMs: 0, text: 'tak' },
      ],
    });
  });

  it('returns null rather than empty lyrics', () => {
    expect(fromLrc('lrclib', 'nothing')).toBeNull();
    expect(fromPlainText('lyricsovh', '   \n\n')).toBeNull();
  });
});

describe('hasTiming', () => {
  it('is true for timed lines', () => {
    expect(
      hasTiming({ sourceId: 'lrclib', kind: 'synced', lines: [{ timeMs: 1_000, text: 'a' }] }),
    ).toBe(true);
  });

  it('is false for plain lyrics', () => {
    expect(
      hasTiming({ sourceId: 'lyricsovh', kind: 'plain', lines: [{ timeMs: 0, text: 'a' }] }),
    ).toBe(false);
  });

  it('is false for lines labelled synced that are all zeros', () => {
    // The case that matters. A clock handed these does not simply fail to
    // highlight: every line compares as "already started", so the search for the
    // current line finds the LAST one, and the panel pins itself to the bottom
    // of the song with no way back up.
    const lines = [
      { timeMs: 0, text: 'a' },
      { timeMs: 0, text: 'b' },
      { timeMs: 0, text: 'c' },
    ];
    expect(hasTiming({ sourceId: 'lrclib', kind: 'synced', lines })).toBe(false);
  });

  it('is true when only some lines are timed', () => {
    // A first line at zero is normal — it is the one that starts at the top.
    const lines = [
      { timeMs: 0, text: 'a' },
      { timeMs: 5_000, text: 'b' },
    ];
    expect(hasTiming({ sourceId: 'lrclib', kind: 'synced', lines })).toBe(true);
  });

  it('is false for no lines at all', () => {
    expect(hasTiming({ sourceId: 'lrclib', kind: 'synced', lines: [] })).toBe(false);
  });
});
