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
