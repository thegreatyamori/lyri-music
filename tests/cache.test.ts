/**
 * The cache, which until now had no tests despite carrying the two rules that
 * decide whether the panel ever recovers from a bad answer: what it is addressed
 * by, and what it refuses to trust from storage.
 *
 * Invented text throughout.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  cacheKeyFor,
  parseIndex,
  prune,
  readEntry,
  writeEntry,
} from '../src/lib/cache';
import type { CacheIndex, CacheLimits } from '../src/lib/cache';
import type { Lyrics, TrackQuery } from '../src/lib/domain/types';

const query: TrackQuery = {
  videoId: 'video-1',
  title: 'Invented Title',
  artist: 'Invented Artist',
  album: null,
  durationMs: 123_400,
  isrc: null,
};

const lyrics: Lyrics = {
  sourceId: 'lrclib',
  kind: 'synced',
  lines: [{ timeMs: 1_000, text: 'zorblat' }],
};

const LIMITS: CacheLimits = { maxEntries: 2, hitTtlMs: 1_000, missTtlMs: 500 };

describe('cacheKeyFor', () => {
  it('is stable across case and whitespace, so a replay still hits', () => {
    expect(cacheKeyFor(query)).toBe(
      cacheKeyFor({ ...query, title: '  invented   TITLE ', artist: 'invented artist' }),
    );
  });

  it('changes when the title changes, which is the whole point', () => {
    expect(cacheKeyFor({ ...query, title: 'Another Title' })).not.toBe(cacheKeyFor(query));
  });

  it('changes when the artist changes', () => {
    expect(cacheKeyFor({ ...query, artist: 'Another Artist' })).not.toBe(cacheKeyFor(query));
  });

  it('changes when the video changes', () => {
    expect(cacheKeyFor({ ...query, videoId: 'video-2' })).not.toBe(cacheKeyFor(query));
  });
});

describe('readEntry and writeEntry', () => {
  it('round-trips a hit', () => {
    const index = writeEntry({}, 'k', lyrics, 0, LIMITS);
    expect(readEntry(index, 'k', 10, LIMITS)).toEqual({ hit: true, lyrics });
  });

  it('round-trips a remembered miss, which is not the same as an absent entry', () => {
    const index = writeEntry({}, 'k', null, 0, LIMITS);
    expect(readEntry(index, 'k', 10, LIMITS)).toEqual({ hit: true, lyrics: null });
  });

  it('reports an absent entry as a miss', () => {
    expect(readEntry({}, 'k', 10, LIMITS)).toEqual({ hit: false });
  });

  it('expires a hit on the hit lifetime', () => {
    const index = writeEntry({}, 'k', lyrics, 0, LIMITS);
    expect(readEntry(index, 'k', 1_001, LIMITS).hit).toBe(false);
  });

  it('expires a miss sooner, because the catalogue moves', () => {
    const index = writeEntry({}, 'k', null, 0, LIMITS);
    expect(readEntry(index, 'k', 600, LIMITS).hit).toBe(false);
  });

  it('treats a clock that went backwards as expired rather than as immortal', () => {
    const index = writeEntry({}, 'k', lyrics, 5_000, LIMITS);
    expect(readEntry(index, 'k', 0, LIMITS).hit).toBe(false);
  });
});

describe('prune', () => {
  it('keeps everything inside the bound', () => {
    const index = writeEntry(writeEntry({}, 'a', lyrics, 0, LIMITS), 'b', lyrics, 0, LIMITS);
    expect(Object.keys(prune(index, 0, LIMITS)).sort()).toEqual(['a', 'b']);
  });

  it('evicts the least recently used when over the bound', () => {
    const index: CacheIndex = {
      old: { lyrics, storedAtMs: 0, usedAtMs: 10 },
      middle: { lyrics, storedAtMs: 0, usedAtMs: 20 },
      recent: { lyrics, storedAtMs: 0, usedAtMs: 30 },
    };

    expect(Object.keys(prune(index, 0, LIMITS)).sort()).toEqual(['middle', 'recent']);
  });

  it('drops expired entries regardless of the bound', () => {
    const index: CacheIndex = { stale: { lyrics, storedAtMs: 0, usedAtMs: 0 } };
    expect(prune(index, 10_000, LIMITS)).toEqual({});
  });

  it('evicts deterministically when the timestamps tie', () => {
    const index: CacheIndex = {
      b: { lyrics, storedAtMs: 0, usedAtMs: 5 },
      a: { lyrics, storedAtMs: 0, usedAtMs: 5 },
      c: { lyrics, storedAtMs: 0, usedAtMs: 9 },
    };

    const first = Object.keys(prune(index, 0, LIMITS));
    const second = Object.keys(prune(index, 0, LIMITS));
    expect(first).toEqual(second);
    expect(first).toContain('c');
  });
});

describe('parseIndex', () => {
  it('returns nothing for shapes that are not an index', () => {
    expect(parseIndex(null)).toEqual({});
    expect(parseIndex([])).toEqual({});
    expect(parseIndex('nope')).toEqual({});
  });

  it('keeps a well-formed entry', () => {
    const parsed = parseIndex({ k: { lyrics, storedAtMs: 1, usedAtMs: 2 } });
    expect(Object.keys(parsed)).toEqual(['k']);
  });

  it('keeps a remembered miss', () => {
    const parsed = parseIndex({ k: { lyrics: null, storedAtMs: 1, usedAtMs: 2 } });
    expect(parsed['k']?.lyrics).toBeNull();
  });

  it('drops an entry whose timestamps are missing or not numbers', () => {
    expect(parseIndex({ k: { lyrics } })).toEqual({});
    expect(parseIndex({ k: { lyrics, storedAtMs: 'soon', usedAtMs: 2 } })).toEqual({});
    expect(parseIndex({ k: { lyrics, storedAtMs: Number.NaN, usedAtMs: 2 } })).toEqual({});
  });

  it('drops an entry whose lyrics are malformed rather than crashing the panel', () => {
    const bad = [
      { sourceId: 1, kind: 'synced', lines: [] },
      { sourceId: 'lrclib', kind: 'sideways', lines: [] },
      { sourceId: 'lrclib', kind: 'synced', lines: 'nope' },
    ];
    for (const value of bad) {
      expect(parseIndex({ k: { lyrics: value, storedAtMs: 1, usedAtMs: 2 } })).toEqual({});
    }
  });

  it('drops lines that are not lines, and an entry left with none', () => {
    const mixed = {
      sourceId: 'lrclib',
      kind: 'synced',
      lines: [{ timeMs: 1_000, text: 'zorblat' }, { timeMs: 'x', text: 5 }, null],
    };
    const parsed = parseIndex({ k: { lyrics: mixed, storedAtMs: 1, usedAtMs: 2 } });
    expect(parsed['k']?.lyrics?.lines).toEqual([{ timeMs: 1_000, text: 'zorblat' }]);

    const empty = { sourceId: 'lrclib', kind: 'synced', lines: [{ timeMs: 'x' }] };
    expect(parseIndex({ k: { lyrics: empty, storedAtMs: 1, usedAtMs: 2 } })).toEqual({});
  });

  it('drops one bad entry without losing the good ones beside it', () => {
    const parsed = parseIndex({
      good: { lyrics, storedAtMs: 1, usedAtMs: 2 },
      bad: null,
    });
    expect(Object.keys(parsed)).toEqual(['good']);
  });

  it('defaults are sane enough to be worth stating', () => {
    expect(DEFAULT_LIMITS.maxEntries).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.missTtlMs).toBeLessThan(DEFAULT_LIMITS.hitTtlMs);
  });
});
