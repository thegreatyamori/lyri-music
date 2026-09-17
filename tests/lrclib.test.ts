import { afterEach, describe, expect, it, vi } from 'vitest';
import { lrclib } from '../src/lib/providers/lrclib';
import type { TrackQuery } from '../src/lib/domain/types';

const query: TrackQuery = {
  videoId: 'video-1',
  title: 'Wibble Song',
  artist: 'The Wibbles',
  album: 'Zorblat',
  durationMs: 123_400,
  isrc: null,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lrclib provider', () => {
  it('returns synced lyrics and prefers synced text', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        id: 7,
        duration: 123.4,
        instrumental: false,
        plainLyrics: 'the wibbles',
        syncedLyrics: '[00:01.00]zorblat\n[00:02.00]the wibbles',
      }),
    );
    vi.stubGlobal('fetch', fetch);

    const lyrics = await lrclib.fetch(query, new AbortController().signal);

    expect(lyrics?.kind).toBe('synced');
    expect(lyrics?.lines).toHaveLength(2);
  });

  it('returns plain lyrics when no synced text is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          id: 8,
          duration: 123.4,
          instrumental: false,
          plainLyrics: 'zorblat\nthe wibbles',
          syncedLyrics: null,
        }),
      ),
    );

    const lyrics = await lrclib.fetch(query, new AbortController().signal);

    expect(lyrics?.kind).toBe('plain');
  });

  it('returns null for instrumental results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          id: 9,
          duration: 123.4,
          instrumental: true,
          plainLyrics: null,
          syncedLyrics: null,
        }),
      ),
    );

    await expect(lrclib.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('falls back to a close search result after a get 404', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(
        response([
          {
            id: 10,
            duration: 124,
            instrumental: false,
            trackName: 'Wibble Song',
            artistName: 'The Wibbles',
            plainLyrics: null,
            syncedLyrics: '[00:00.00]zorblat',
          },
        ]),
      );
    vi.stubGlobal('fetch', fetch);

    const lyrics = await lrclib.fetch(query, new AbortController().signal);

    expect(lyrics?.kind).toBe('synced');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a search result more than five seconds from the query', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(
        response([
          {
            id: 11,
            duration: 130,
            instrumental: false,
            plainLyrics: 'zorblat',
            syncedLyrics: null,
          },
        ]),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(lrclib.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null for a network rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(lrclib.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null for an aborted request', async () => {
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

  it('sends duration in rounded seconds, not milliseconds', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        id: 12,
        duration: 123.4,
        instrumental: false,
        plainLyrics: 'zorblat',
        syncedLyrics: null,
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await lrclib.fetch(query, new AbortController().signal);

    const url = String(fetch.mock.calls[0]?.[0]);
    expect(new URL(url).searchParams.get('duration')).toBe('123');
  });
});

/** A complete LRCLIB row, so a test only has to override the field it is about. */
const syncedRow = {
  id: 20,
  duration: 123.4,
  instrumental: false,
  trackName: 'Wibble Song',
  artistName: 'The Wibbles',
  plainLyrics: null,
  syncedLyrics: '[00:01.00]zorblat',
};

function urlOf(fetch: ReturnType<typeof vi.fn>, call: number): URL {
  return new URL(String(fetch.mock.calls[call]?.[0]));
}

/**
 * The three findings that drive the lookup order, each pinned so they cannot be
 * quietly undone:
 *
 *   - album_name turns a hit into a 404 when it is wrong
 *   - a version suffix in track_name does too
 *   - only the free-text `q` search tolerates a suffix at all
 */
describe('lrclib lookup strategy', () => {
  it('never sends album_name, because a wrong album turns a hit into a 404', async () => {
    const fetch = vi.fn().mockResolvedValue(response(syncedRow));
    vi.stubGlobal('fetch', fetch);

    await lrclib.fetch(query, new AbortController().signal);

    expect(urlOf(fetch, 0).searchParams.has('album_name')).toBe(false);
    expect(urlOf(fetch, 0).searchParams.get('artist_name')).toBe('The Wibbles');
  });

  it('retries the exact lookup on a looser title before resorting to search', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(syncedRow));
    vi.stubGlobal('fetch', fetch);

    const lyrics = await lrclib.fetch(
      { ...query, title: 'Wibble Song (Remastered 2011)' },
      new AbortController().signal,
    );

    expect(lyrics?.kind).toBe('synced');
    expect(urlOf(fetch, 0).searchParams.get('track_name')).toBe('Wibble Song (Remastered 2011)');
    expect(urlOf(fetch, 1).searchParams.get('track_name')).toBe('Wibble Song');
  });

  it('falls back to the free-text search, the only form that survives a suffix', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response([syncedRow]));
    vi.stubGlobal('fetch', fetch);

    const lyrics = await lrclib.fetch(query, new AbortController().signal);

    expect(lyrics?.kind).toBe('synced');
    expect(urlOf(fetch, 1).pathname).toBe('/api/search');
    expect(urlOf(fetch, 1).searchParams.get('q')).toBe('The Wibbles Wibble Song');
  });

  it('costs one request when the exact lookup hits, which is the common case', async () => {
    const fetch = vi.fn().mockResolvedValue(response(syncedRow));
    vi.stubGlobal('fetch', fetch);

    await lrclib.fetch(query, new AbortController().signal);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a free-text candidate that shares no name with the query', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(
        response([{ ...syncedRow, trackName: 'Something Else', artistName: 'Another Band' }]),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(lrclib.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('accepts a name match even when the other side is decorated', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(
        response([{ ...syncedRow, trackName: 'Wibble Song;Wibble Song' }]),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(lrclib.fetch(query, new AbortController().signal)).resolves.not.toBeNull();
  });

  it('scales the duration window with the track rather than fixing it at five seconds', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response([{ ...syncedRow, duration: 615 }])); // 15 s off
    vi.stubGlobal('fetch', fetch);

    const tenMinutes = { ...query, durationMs: 600_000 };

    await expect(lrclib.fetch(tenMinutes, new AbortController().signal)).resolves.not.toBeNull();
  });

  it('still rejects that same offset on a short track, where it is most of a verse', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response([{ ...syncedRow, duration: 135 }])); // 15 s off
    vi.stubGlobal('fetch', fetch);

    const twoMinutes = { ...query, durationMs: 120_000 };

    await expect(lrclib.fetch(twoMinutes, new AbortController().signal)).resolves.toBeNull();
  });
});
