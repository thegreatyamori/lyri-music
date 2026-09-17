/**
 * The Lookup — the module everything else is arranged around, and until now the
 * one with no tests of its own.
 *
 * These pin the rules that are easy to break from a distance: which answer wins,
 * what is remembered, what is deliberately not remembered, and that the losers
 * of a race are cancelled.
 */

import { describe, expect, it, vi } from 'vitest';
import { createCache, createMemoryStore } from '../src/lib/cache';
import type { Lyrics, TrackQuery } from '../src/lib/domain/types';
import { lookup } from '../src/lib/lookup';
import type { LyricsProvider } from '../src/lib/providers/provider';

const query: TrackQuery = {
  videoId: 'video-1',
  title: 'Wibble Song',
  artist: 'The Wibbles',
  album: null,
  durationMs: 123_400,
  isrc: null,
};

function lyrics(sourceId: Lyrics['sourceId'], kind: Lyrics['kind']): Lyrics {
  return { sourceId, kind, lines: [{ timeMs: kind === 'synced' ? 1_000 : 0, text: 'zorblat' }] };
}

interface FakeOptions {
  readonly id: LyricsProvider['id'];
  readonly result?: Lyrics | null;
  readonly delayMs?: number;
  readonly throws?: boolean;
}

function fakeProvider(options: FakeOptions): LyricsProvider {
  return {
    id: options.id,
    label: options.id,
    detail: 'test',
    kind: 'synced',
    enabledByDefault: true,
    fetch: (_query, signal) =>
      new Promise((resolve, reject) => {
        const settle = (): void => {
          if (options.throws === true) reject(new Error('provider blew up'));
          else resolve(options.result ?? null);
        };
        if (options.delayMs === undefined) {
          // Still honour cancellation on a slow microtask, so a test that
          // cancels immediately cannot be satisfied by luck.
          queueMicrotask(() => {
            if (signal.aborted) resolve(null);
            else settle();
          });
          return;
        }
        setTimeout(() => (signal.aborted ? resolve(null) : settle()), options.delayMs);
      }),
  };
}

function newCache() {
  return createCache(createMemoryStore(), () => Date.now());
}

describe('lookup', () => {
  it('returns the highest-priority answer among those that produced one', async () => {
    const deps = {
      providers: [
        fakeProvider({ id: 'lrclib', result: null }),
        fakeProvider({ id: 'kugou', result: lyrics('kugou', 'synced') }),
      ],
      cache: newCache(),
    };

    const result = await lookup(query, deps);

    expect(result?.sourceId).toBe('kugou');
  });

  it('prefers a timed answer over an untimed one regardless of priority', async () => {
    const deps = {
      providers: [
        fakeProvider({ id: 'lrclib', result: lyrics('lrclib', 'plain') }),
        fakeProvider({ id: 'kugou', result: lyrics('kugou', 'synced') }),
      ],
      cache: newCache(),
    };

    // The plain answer came from the higher-priority source and is still not
    // taken while something the clock can follow is available.
    const result = await lookup(query, deps);

    expect(result?.lyrics.kind).toBe('synced');
    expect(result?.sourceId).toBe('kugou');
  });

  it('falls back to an untimed answer when nothing timed exists', async () => {
    const deps = {
      providers: [fakeProvider({ id: 'lrclib', result: lyrics('lrclib', 'plain') })],
      cache: newCache(),
    };

    await expect(lookup(query, deps)).resolves.toMatchObject({ sourceId: 'lrclib' });
  });

  it('skips a provider that throws instead of losing the whole lookup', async () => {
    const deps = {
      providers: [
        fakeProvider({ id: 'lrclib', throws: true }),
        fakeProvider({ id: 'kugou', result: lyrics('kugou', 'synced') }),
      ],
      cache: newCache(),
    };

    await expect(lookup(query, deps)).resolves.toMatchObject({ sourceId: 'kugou' });
  });

  it('answers from the cache without asking anyone a second time', async () => {
    const cache = newCache();
    const first = fakeProvider({ id: 'lrclib', result: lyrics('lrclib', 'synced') });
    const spy = vi.spyOn(first, 'fetch');

    await lookup(query, { providers: [first], cache });
    const second = await lookup(query, { providers: [first], cache });

    expect(second?.sourceId).toBe('lrclib');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cancels the providers that lost the race', async () => {
    const seen: AbortSignal[] = [];
    const slow: LyricsProvider = {
      ...fakeProvider({ id: 'kugou' }),
      fetch: (_query, signal) => {
        seen.push(signal);
        return new Promise((resolve) => setTimeout(() => resolve(null), 5_000));
      },
    };

    // The winner comes first, which is what makes the lookup return without
    // waiting: answers are consumed in priority order, so a slow source ahead of
    // a fast one is waited for on purpose.
    const deps = {
      providers: [fakeProvider({ id: 'lrclib', result: lyrics('lrclib', 'synced') }), slow],
      cache: newCache(),
    };

    await lookup(query, deps);

    expect(seen[0]?.aborted).toBe(true);
  });

  it('holds to the deadline even against a provider that ignores the signal', async () => {
    const stubborn: LyricsProvider = {
      ...fakeProvider({ id: 'lrclib' }),
      // Never settles, never looks at the signal. A deadline that only works on
      // cooperative code would hang here forever.
      fetch: () => new Promise(() => undefined),
    };

    const started = Date.now();
    const result = await lookup(query, {
      providers: [stubborn],
      cache: newCache(),
      deadlineMs: 40,
    });

    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('remembers a miss when the question was complete', async () => {
    const cache = newCache();
    const empty = fakeProvider({ id: 'lrclib', result: null });
    const spy = vi.spyOn(empty, 'fetch');

    await lookup(query, { providers: [empty], cache });
    await lookup(query, { providers: [empty], cache });

    // The second call is answered from the negative cache, which is what stops
    // a track nobody has from costing a lookup on every play.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does NOT remember a miss when the duration was never known', async () => {
    const cache = newCache();
    const empty = fakeProvider({ id: 'lrclib', result: null });
    const spy = vi.spyOn(empty, 'fetch');

    // What a lookup looks like in the moment between a track starting and the
    // video element knowing how long it is.
    const incomplete = { ...query, durationMs: 0 };
    await lookup(incomplete, { providers: [empty], cache });
    await lookup(incomplete, { providers: [empty], cache });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('asks again when the caller forces it, past a remembered miss', async () => {
    const cache = newCache();
    const empty = fakeProvider({ id: 'lrclib', result: null });
    const spy = vi.spyOn(empty, 'fetch');

    await lookup(query, { providers: [empty], cache });
    await lookup(query, { providers: [empty], cache, force: true });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not answer a corrected title from the entry an earlier wrong title created', async () => {
    // The exact shape of the bug: the same video, asked once with the previous
    // song's name and then with the right one. An id-keyed cache would serve the
    // first answer for the second question and the panel would never recover.
    const cache = newCache();
    const provider = fakeProvider({ id: 'lrclib', result: lyrics('lrclib', 'synced') });
    const spy = vi.spyOn(provider, 'fetch');

    await lookup({ ...query, title: 'Invented Wrong Title' }, { providers: [provider], cache });
    await lookup({ ...query, title: 'Invented Right Title' }, { providers: [provider], cache });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('still answers a replay of the very same question from the cache', async () => {
    const cache = newCache();
    const provider = fakeProvider({ id: 'lrclib', result: lyrics('lrclib', 'synced') });
    const spy = vi.spyOn(provider, 'fetch');

    await lookup({ ...query, title: 'Invented Right Title' }, { providers: [provider], cache });
    await lookup({ ...query, title: 'Invented Right Title' }, { providers: [provider], cache });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns null rather than an empty lyric', async () => {
    const empty: Lyrics = { sourceId: 'lrclib', kind: 'synced', lines: [] };
    const deps = {
      providers: [fakeProvider({ id: 'lrclib', result: empty })],
      cache: newCache(),
    };

    await expect(lookup(query, deps)).resolves.toBeNull();
  });

  it('returns null with no providers at all, and does not throw', async () => {
    await expect(lookup(query, { providers: [], cache: newCache() })).resolves.toBeNull();
  });
});
