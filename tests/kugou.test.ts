import { afterEach, describe, expect, it, vi } from 'vitest';
import { kugou } from '../src/lib/providers/kugou';
import type { TrackQuery } from '../src/lib/domain/types';

const query: TrackQuery = {
  videoId: 'video-kugou',
  title: 'Invented Tune',
  artist: 'Imaginary Band',
  album: null,
  durationMs: 123_000,
  isrc: null,
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function encoded(lrc: string): string {
  return Buffer.from(lrc).toString('base64');
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'candidate-id',
    accesskey: 'candidate-key',
    singer: query.artist,
    song: query.title,
    duration: query.durationMs,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('kugou provider', () => {
  it('searches, selects, decodes, cleans, and parses synced lyrics', async () => {
    const lrc = [
      '[ti:Invented Tune]',
      '[ar:Imaginary Band]',
      '[00:00.49]Invented Tune - Imaginary Band',
      '[00:01.45]Lyrics by：A. Fiction',
      '[00:02.90]Composed by：B. Fiction',
      '[00:18.40]žindle floop',
      '[00:22.10]second invented line',
    ].join('\n');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ status: 200, candidates: [candidate()] }))
      .mockResolvedValueOnce(response({ status: 200, fmt: 'lrc', content: encoded(lrc) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await kugou.fetch(query, new AbortController().signal);

    expect(result?.kind).toBe('synced');
    expect(result?.lines).toHaveLength(2);
    expect(result?.lines[0]?.text).toBe('žindle floop');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends duration to search in milliseconds', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ status: 200, candidates: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await kugou.fetch(query, new AbortController().signal);

    const searchUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(new URL(searchUrl).searchParams.get('duration')).toBe('123000');
  });

  it('rejects a candidate whose duration is eight seconds off', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({ status: 200, candidates: [candidate({ duration: query.durationMs + 8_000 })] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(kugou.fetch(query, new AbortController().signal)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for empty candidates', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(response({ status: 200, candidates: [] })));

    await expect(kugou.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null for a non-200 download status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ status: 200, candidates: [candidate()] }))
      .mockResolvedValueOnce(response({ status: 404, content: encoded('[00:01.00]not used') }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(kugou.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });

  it('returns null when the network rejects', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')));

    await expect(kugou.fetch(query, new AbortController().signal)).resolves.toBeNull();
  });
});
