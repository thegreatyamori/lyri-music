/**
 * Genius is implemented but NOT wired up — see the note in
 * `src/lib/providers/genius.ts`. These tests exist so that the code does not
 * rot while it sits switched off: the parsing is the risky part, and it is
 * pinned here rather than left to be discovered on the day it is enabled.
 *
 * Invented markup and invented words throughout. No real page, no real lyrics.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackQuery } from '../src/lib/domain/types';
import { genius } from '../src/lib/providers/genius';

const query: TrackQuery = {
  videoId: 'video-1',
  title: 'Wibble Song',
  artist: 'The Wibbles',
  album: null,
  durationMs: 123_000,
  isrc: null,
};

interface Hit {
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly instrumental?: boolean;
}

function searchBody(hits: readonly Hit[]): unknown {
  return {
    response: {
      sections: [
        {
          type: 'song',
          hits: hits.map((hit) => ({
            type: 'song',
            result: {
              _type: 'song',
              url: hit.url,
              title: hit.title,
              primary_artist: { name: hit.artist },
              instrumental: hit.instrumental ?? false,
            },
          })),
        },
      ],
    },
  };
}

function page(lines: string): Response {
  return new Response(`<html><body><div data-lyrics-container="true">${lines}</div></body></html>`, {
    status: 200,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('genius provider', () => {
  it('picks the best-matching hit and returns plain lyrics', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          searchBody([
            { url: 'https://genius.com/wrong", ', title: 'Wibble Song', artist: 'Another Band' },
            { url: 'https://genius.com/right', title: 'Wibble Song', artist: 'The Wibbles' },
          ]),
        ),
      )
      .mockResolvedValueOnce(page('zorblat<br>the wibbles'));
    vi.stubGlobal('fetch', fetch);

    const lyrics = await genius.fetch(query, new AbortController().signal);

    expect(lyrics?.kind).toBe('plain');
    expect(lyrics?.sourceId).toBe('genius');
    expect(lyrics?.lines.map((line) => line.text)).toEqual(['zorblat', 'the wibbles']);
    // The second hit scored higher, so the page fetched must be its URL.
    expect(String(fetch.mock.calls[1]?.[0])).toBe('https://genius.com/right');
  });

  it('drops section headers and the advert spliced into the lyrics', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(searchBody([{ url: 'https://genius.com/x', title: 'Wibble Song', artist: 'The Wibbles' }])))
      .mockResolvedValueOnce(
        page('[Verse 1]<br>zorblat<br><br>You might also like<br>[Chorus]<br>flimbo'),
      );
    vi.stubGlobal('fetch', fetch);

    const lyrics = await genius.fetch(query, new AbortController().signal);

    expect(lyrics?.lines.map((line) => line.text)).toEqual(['zorblat', 'flimbo']);
  });

  it('skips an instrumental result', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(searchBody([{ url: 'https://genius.com/x', title: 'Wibble Song', artist: 'The Wibbles', instrumental: true }])),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(genius.fetch(query, new AbortController().signal)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a hit that shares nothing but one word', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          searchBody([
            { url: 'https://genius.com/x', title: 'Wibble Song Deluxe', artist: 'Another Band' },
          ]),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(genius.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('accepts an exact title even with a differently credited artist', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(searchBody([{ url: 'https://genius.com/x', title: 'Wibble Song', artist: 'Nax' }])))
      .mockResolvedValueOnce(page('zorblat'));
    vi.stubGlobal('fetch', fetch);

    await expect(genius.fetch(query, new AbortController().signal)).resolves.not.toBeNull();
  });

  it('ignores a section that is not a song', async () => {
    const body = { response: { sections: [{ type: 'song', hits: [{ type: 'song', result: { _type: 'album', url: 'https://genius.com/a', title: 'Wibble Song' } }] }] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(body)));

    await expect(genius.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null when the search is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 500)));

    await expect(genius.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null when the page is not ok', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(searchBody([{ url: 'https://genius.com/x', title: 'Wibble Song', artist: 'The Wibbles' }])))
      .mockResolvedValueOnce(new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetch);

    await expect(genius.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null when the page carries no lyrics container', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(searchBody([{ url: 'https://genius.com/x', title: 'Wibble Song', artist: 'The Wibbles' }])))
      .mockResolvedValueOnce(new Response('<html><body><p>nothing</p></body></html>', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(genius.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null on a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(genius.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null when the request is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));

    await expect(genius.fetch(query, controller.signal)).resolves.toBeNull();
  });

  it('sends no header it cannot send, and passes the signal through', async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(searchBody([{ url: 'https://genius.com/x', title: 'Wibble Song', artist: 'The Wibbles' }])))
      .mockResolvedValueOnce(page('zorblat'));
    vi.stubGlobal('fetch', fetch);

    await genius.fetch(query, controller.signal);

    // Genius accepts a browser's own User-Agent, which fetch supplies. Setting
    // one by hand is a forbidden header and would be dropped, so this provider
    // deliberately sets none — unlike the LRCLIB one, which still tries.
    expect(fetch.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
  });
});
