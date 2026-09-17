import type { LyricsProvider } from './provider';
import type { TrackQuery } from '../domain/types';
import { fromLrc, parseLrc } from '../domain/lyrics';

const SEARCH_URL = 'https://lyrics.kugou.com/search';
const DOWNLOAD_URL = 'https://lyrics.kugou.com/download';
const MAX_DURATION_DELTA_MS = 3_000;
const CREDIT_PREFIXES = [
  'lyrics by',
  'composed by',
  'arranged by',
  'produced by',
  'mixed by',
  'mastered by',
  '作词',
  '作曲',
  '编曲',
  '制作人',
  '混音',
  '母带',
];

interface Candidate {
  readonly id: string;
  readonly accesskey: string;
  readonly singer: string;
  readonly song: string;
  readonly duration: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function candidateFrom(value: unknown): Candidate | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asNonEmptyString(record['id']) ?? (asNumber(record['id'])?.toString() ?? null);
  const accesskey =
    asNonEmptyString(record['accesskey']) ?? (asNumber(record['accesskey'])?.toString() ?? null);
  const singer = asNonEmptyString(record['singer']);
  const song = asNonEmptyString(record['song']);
  const duration = asNumber(record['duration']);
  return id !== null && accesskey !== null && singer !== null && song !== null && duration !== null
    ? { id, accesskey, singer, song, duration }
    : null;
}

function selectCandidate(candidates: readonly Candidate[], durationMs: number): Candidate | null {
  const first = candidates[0];
  if (first === undefined) return null;
  if (durationMs <= 0) return first;

  let closest = first;
  let closestDelta = Math.abs(first.duration - durationMs);
  for (const candidate of candidates.slice(1)) {
    const delta = Math.abs(candidate.duration - durationMs);
    if (delta < closestDelta) {
      closest = candidate;
      closestDelta = delta;
    }
  }
  return closestDelta <= MAX_DURATION_DELTA_MS ? closest : null;
}

function isCredit(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase();
  return CREDIT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isRepeat(text: string, candidate: Candidate): boolean {
  const normalized = text.trim().toLocaleLowerCase();
  const song = candidate.song.toLocaleLowerCase();
  const singer = candidate.singer.toLocaleLowerCase();
  return normalized === `${song} - ${singer}` || normalized === `${singer} - ${song}`;
}

function cleanLrc(raw: string, candidate: Candidate): string {
  let cleaning = true;
  return raw
    .split(/\r?\n/)
    .filter((rawLine) => {
      if (!cleaning) return true;
      const parsed = parseLrc(rawLine);
      if (parsed.length === 0) return true;
      if (parsed.every((line) => isRepeat(line.text, candidate) || isCredit(line.text))) {
        return false;
      }
      cleaning = false;
      return true;
    })
    .join('\n');
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function json(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

export const kugou: LyricsProvider = {
  id: 'kugou',
  label: 'KuGou',
  detail: 'Unofficial KuGou lyrics',
  kind: 'synced',
  enabledByDefault: false,

  async fetch(query: TrackQuery, signal: AbortSignal) {
    try {
      const searchParams = new URLSearchParams({
        ver: '1',
        man: 'yes',
        client: 'pc',
        keyword: `${query.artist} - ${query.title}`,
        duration: String(query.durationMs),
      });
      const searchResponse = await fetch(`${SEARCH_URL}?${searchParams}`, { signal });
      const searchBody = asRecord(await json(searchResponse));
      const rawCandidates = searchBody?.['candidates'];
      const candidates = Array.isArray(rawCandidates)
        ? rawCandidates.map(candidateFrom).filter((candidate): candidate is Candidate => candidate !== null)
        : [];
      const candidate = selectCandidate(candidates, query.durationMs);
      if (candidate === null) return null;

      const downloadParams = new URLSearchParams({
        ver: '1',
        client: 'pc',
        id: candidate.id,
        accesskey: candidate.accesskey,
        fmt: 'lrc',
        charset: 'utf8',
      });
      const downloadResponse = await fetch(`${DOWNLOAD_URL}?${downloadParams}`, { signal });
      const downloadBody = asRecord(await json(downloadResponse));
      if (downloadBody?.['status'] !== 200) return null;
      const content = asNonEmptyString(downloadBody['content']);
      if (content === null) return null;

      const cleaned = cleanLrc(decodeBase64(content), candidate);
      return fromLrc('kugou', cleaned);
    } catch {
      return null;
    }
  },
};
