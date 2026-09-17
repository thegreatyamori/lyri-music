import { beforeEach, describe, expect, it, vi } from 'vitest';
import { netease } from '../src/lib/providers/netease';
import type { TrackQuery } from '../src/lib/domain/types';

const query: TrackQuery = {
  videoId: 'video-test',
  title: 'Gromble Tune',
  artist: 'The Wibbles',
  album: null,
  durationMs: 120_000,
  isrc: null,
};

const response = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const searchResult = (songs: unknown[]) => ({ result: { songs } });
const song = (id: number, duration: number, artists = [{ name: 'The Wibbles' }]) => ({
  id,
  name: 'Invented Tune',
  duration,
  artists,
  album: { name: 'Invented Album' },
});

describe('netease provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('searches, chooses a song, and parses synced lyrics', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(response(searchResult([song(41, 120_500)])))
      .mockResolvedValueOnce(response({ lrc: { lyric: '[00:01.00]zorblat\n[00:03.00]quenk' } }));

    const result = await netease.fetch(query, new AbortController().signal);

    expect(result).toEqual({
      sourceId: 'netease',
      kind: 'synced',
      lines: [
        { timeMs: 1_000, text: 'zorblat' },
        { timeMs: 3_000, text: 'quenk' },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null for an uncollected lyric', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(response(searchResult([song(42, 120_000)])))
      .mockResolvedValueOnce(response({ uncollected: true, lrc: { lyric: '[00:01.00]blorp' } }));

    await expect(netease.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null for an empty lyric', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(response(searchResult([song(43, 120_000)])))
      .mockResolvedValueOnce(response({ lrc: { lyric: '' } }));

    await expect(netease.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('rejects a song whose duration is eight seconds away', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(response(searchResult([song(44, 128_000)])));

    await expect(netease.fetch(query, new AbortController().signal)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for an empty search result', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(response(searchResult([])));

    await expect(netease.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('prefers an artist match over a closer duration-only match', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        response(
          searchResult([
            song(45, 120_100, [{ name: 'Other Group' }]),
            song(46, 121_500, [{ name: 'The Wibbles' }]),
          ]),
        ),
      )
      .mockResolvedValueOnce(response({ lrc: { lyric: '[00:01.00]artistpick' } }));

    await expect(netease.fetch(query, new AbortController().signal)).resolves.toMatchObject({
      lines: [{ text: 'artistpick' }],
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('id=46');
  });

  it('strips leading credit lines and preserves the first real line', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(response(searchResult([song(47, 120_000)])))
      .mockResolvedValueOnce(
        response({
          lrc: {
            lyric:
              '[00:00.000] 作词 : Invented Writer\n[00:01.000] Produced by : Invented Maker\n[00:18.400]first invented line\n[00:20.000]second invented line',
          },
        }),
      );

    const result = await netease.fetch(query, new AbortController().signal);

    expect(result?.lines[0]?.text).toBe('first invented line');
    expect(result?.lines).toHaveLength(2);
  });

  it('returns null when the network rejects', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('invented network failure'));

    await expect(netease.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('preserves non-ASCII lyric text', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(response(searchResult([song(48, 120_000)])))
      .mockResolvedValueOnce(response({ lrc: { lyric: '[00:02.00]zümblé' } }));

    const result = await netease.fetch(query, new AbortController().signal);

    expect(result?.lines[0]?.text).toBe('zümblé');
  });
});
