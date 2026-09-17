/**
 * The LRCLIB provider, exercised on invented text with a URL-routed stub.
 *
 * Routing by URL rather than counting calls keeps these tests honest when the
 * attempt order changes — which it does, because the order is the thing the
 * provider exists to get right. Every behavioural claim here was checked
 * against the live service first; see the notes in the provider.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackQuery } from '../src/lib/domain/types';
import { lrclib, retryAfterRemainingMs } from '../src/lib/providers/lrclib';

const query: TrackQuery = {
  videoId: 'video-1',
  title: 'Wibble Song',
  artist: 'The Wibbles',
  album: 'Zorblat',
  durationMs: 123_400,
  isrc: null,
};

const signal = (): AbortSignal => new AbortController().signal;

/** A complete LRCLIB row, so a test overrides only the field it is about. */
const syncedRow = {
  id: 20,
  duration: 123.4,
  instrumental: false,
  trackName: 'Wibble Song',
  artistName: 'The Wibbles',
  plainLyrics: null,
  syncedLyrics: '[00:01.00]zorblat',
};

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  // Built up rather than passed inline: `exactOptionalPropertyTypes` is on, and
  // an explicit `headers: undefined` is not the same as an absent property.
  const init: ResponseInit = { status };
  if (headers !== undefined) init.headers = headers;
  return new Response(JSON.stringify(body), init);
}

const notFound = (): Response => json({ code: 404, name: 'TrackNotFound' }, 404);

interface Call {
  readonly url: URL;
  readonly init: RequestInit | undefined;
}

function stubFetch(handler: (url: URL, call: number) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return Promise.resolve(handler(url, calls.length - 1));
    }),
  );
  return calls;
}

function durationOf(url: URL): string | null {
  return url.searchParams.get('duration');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lrclib result handling', () => {
  it('returns synced lyrics when the record has them', async () => {
    stubFetch(() => json(syncedRow));

    const lyrics = await lrclib.fetch(query, signal());

    expect(lyrics?.kind).toBe('synced');
    expect(lyrics?.sourceId).toBe('lrclib');
    expect(lyrics?.lines).toHaveLength(1);
  });

  it('returns plain lyrics when there are no timings', async () => {
    stubFetch(() => json({ ...syncedRow, syncedLyrics: null, plainLyrics: 'zorblat' }));

    await expect(lrclib.fetch(query, signal())).resolves.toMatchObject({ kind: 'plain' });
  });

  it('returns null for an instrumental record', async () => {
    stubFetch(() => json({ ...syncedRow, instrumental: true, syncedLyrics: null }));

    await expect(lrclib.fetch(query, signal())).resolves.toBeNull();
  });

  it('returns null for a network rejection without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(lrclib.fetch(query, signal())).resolves.toBeNull();
  });

  it('returns null when aborted, and passes the signal through', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetch);

    await expect(lrclib.fetch(query, controller.signal)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('duration=123'),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe('lrclib request hygiene', () => {
  it('identifies the client with the headers the docs offer to browsers', async () => {
    const calls = stubFetch(() => json(syncedRow));

    await lrclib.fetch(query, signal());

    // User-Agent is forbidden in fetch, so LRCLIB documents these two instead.
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['X-User-Agent']).toContain('LyriMusic');
    expect(headers['Lrclib-Client']).toContain('LyriMusic');
  });

  it('never sends album_name, because a wrong album turns a hit into a 404', async () => {
    const calls = stubFetch(() => json(syncedRow));

    await lrclib.fetch(query, signal());

    expect(calls[0]?.url.searchParams.has('album_name')).toBe(false);
  });

  it('sends duration in rounded seconds, not milliseconds', async () => {
    const calls = stubFetch(() => json(syncedRow));

    await lrclib.fetch(query, signal());

    expect(durationOf(calls[0]!.url)).toBe('123');
  });

  it('omits duration entirely when it is zero, which the endpoint rejects with a 400', async () => {
    const calls = stubFetch(() => json(syncedRow));

    // What a track looks like before the video element knows its length.
    await lrclib.fetch({ ...query, durationMs: 0 }, signal());

    expect(calls[0]?.url.searchParams.has('duration')).toBe(false);
  });

  it('omits duration when it is beyond the documented maximum', async () => {
    const calls = stubFetch(() => json(syncedRow));

    await lrclib.fetch({ ...query, durationMs: 7_200_000 }, signal());

    expect(calls[0]!.url.searchParams.has('duration')).toBe(false);
  });
});

describe('lrclib lookup strategy', () => {
  it('costs one request when the precise attempt hits', async () => {
    const calls = stubFetch(() => json(syncedRow));

    await lrclib.fetch(query, signal());

    expect(calls).toHaveLength(1);
    expect(durationOf(calls[0]!.url)).toBe('123');
  });

  it('retries the exact lookup WITHOUT duration after a 404', async () => {
    // This is the attempt that rescues the common miss: LRCLIB matches duration
    // within ±2 s of its own record, and a YouTube track often differs by more.
    const calls = stubFetch((url) =>
      url.searchParams.has('duration') ? notFound() : json(syncedRow),
    );

    const lyrics = await lrclib.fetch(query, signal());

    expect(lyrics?.kind).toBe('synced');
    expect(calls).toHaveLength(2);
    expect(durationOf(calls[0]!.url)).toBe('123');
    expect(durationOf(calls[1]!.url)).toBeNull();
  });

  it('retries on a looser title when the title carries a version suffix', async () => {
    const calls = stubFetch((url) =>
      url.searchParams.get('track_name') === 'Wibble Song' ? json(syncedRow) : notFound(),
    );

    const lyrics = await lrclib.fetch(
      { ...query, title: 'Wibble Song (Remastered 2011)' },
      signal(),
    );

    expect(lyrics?.kind).toBe('synced');
    expect(calls[0]!.url.searchParams.get('track_name')).toBe('Wibble Song (Remastered 2011)');
    expect(calls[calls.length - 1]!.url.searchParams.get('track_name')).toBe('Wibble Song');
  });

  it('falls back to the free-text search, carrying artist and title as q', async () => {
    const calls = stubFetch((url) =>
      url.pathname === '/api/search' ? json([syncedRow]) : notFound(),
    );

    const lyrics = await lrclib.fetch(query, signal());

    expect(lyrics?.kind).toBe('synced');
    expect(calls[calls.length - 1]!.url.searchParams.get('q')).toBe('The Wibbles Wibble Song');
  });

  it('does not ask LRCLIB at all, beyond the search, when everything else missed', async () => {
    const calls = stubFetch((url) => (url.pathname === '/api/search' ? json([]) : notFound()));

    await expect(lrclib.fetch(query, signal())).resolves.toBeNull();
    // Two exact attempts, a search, and nothing more.
    expect(calls).toHaveLength(3);
  });

  it('rejects a free-text candidate that shares no name with the query', async () => {
    stubFetch((url) =>
      url.pathname === '/api/search'
        ? json([{ ...syncedRow, trackName: 'Something Else', artistName: 'Another Band' }])
        : notFound(),
    );

    await expect(lrclib.fetch(query, signal())).resolves.toBeNull();
  });

  it('accepts a free-text candidate whose name is decorated by the provider', async () => {
    stubFetch((url) =>
      url.pathname === '/api/search'
        ? json([{ ...syncedRow, trackName: 'Wibble Song;Wibble Song' }])
        : notFound(),
    );

    await expect(lrclib.fetch(query, signal())).resolves.not.toBeNull();
  });

  it('scales the free-text duration window with the track length', async () => {
    stubFetch((url) =>
      url.pathname === '/api/search' ? json([{ ...syncedRow, duration: 615 }]) : notFound(),
    );

    // Ten minutes: a 15 s difference is within the window.
    await expect(
      lrclib.fetch({ ...query, durationMs: 600_000 }, signal()),
    ).resolves.not.toBeNull();
  });

  it('still rejects that same offset on a short track, where it is most of a verse', async () => {
    stubFetch((url) =>
      url.pathname === '/api/search' ? json([{ ...syncedRow, duration: 135 }]) : notFound(),
    );

    await expect(lrclib.fetch({ ...query, durationMs: 120_000 }, signal())).resolves.toBeNull();
  });
});

/**
 * LRCLIB is explicit that a 429 must be honoured rather than retried past, and
 * that ignoring it can earn a temporary ban.
 *
 * Fake timers are used so the deadline can be inspected without waiting for it.
 * The fake system time is far in the past, so the moment real timers are
 * restored every deadline is already behind us and the next test starts clean.
 */
describe('lrclib rate limiting', () => {
  /**
   * The block deadline is module state, because it belongs to the connection
   * rather than to one lookup. Each test therefore starts at a system time past
   * anything a previous test could have set, so no test inherits another's wait.
   */
  let fakeNow = 1_000_000;

  beforeEach(() => {
    fakeNow += 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops the whole lookup on a 429 and records the wait it was given', async () => {
    const calls = stubFetch(() => json({ code: 429 }, 429, { 'Retry-After': '30' }));

    await expect(lrclib.fetch(query, signal())).resolves.toBeNull();

    // One request, not four: the server said wait, so nothing else is asked.
    expect(calls).toHaveLength(1);
    expect(retryAfterRemainingMs(Date.now())).toBe(30_000);
  });

  it('asks nothing at all while the wait is still pending', async () => {
    stubFetch(() => json({ code: 429 }, 429, { 'Retry-After': '30' }));
    await lrclib.fetch(query, signal());

    const second = stubFetch(() => json(syncedRow));
    await expect(lrclib.fetch(query, signal())).resolves.toBeNull();

    expect(second).toHaveLength(0);
  });

  it('asks again once the wait has passed', async () => {
    stubFetch(() => json({ code: 429 }, 429, { 'Retry-After': '30' }));
    await lrclib.fetch(query, signal());

    vi.setSystemTime(fakeNow + 31_000);

    const calls = stubFetch(() => json(syncedRow));
    await expect(lrclib.fetch(query, signal())).resolves.not.toBeNull();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('uses a default backoff when the header is missing, rather than none', async () => {
    const calls = stubFetch(() => json({ code: 429 }, 429));

    await lrclib.fetch(query, signal());

    expect(calls).toHaveLength(1);
    expect(retryAfterRemainingMs(Date.now())).toBeGreaterThan(0);
  });

  it('ignores a nonsense Retry-After instead of trusting it', async () => {
    stubFetch(() => json({ code: 429 }, 429, { 'Retry-After': 'soon' }));

    await lrclib.fetch(query, signal());

    expect(retryAfterRemainingMs(Date.now())).toBeGreaterThan(0);
  });

  it('does not treat a 404 as a reason to hold off', async () => {
    stubFetch(() => notFound());

    await lrclib.fetch(query, signal());

    expect(retryAfterRemainingMs(Date.now())).toBe(0);
  });
});
