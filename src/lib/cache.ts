/**
 * The lyrics cache.
 *
 * Two halves, deliberately split:
 *
 *  - A PURE core — `readEntry`, `writeEntry`, `parseIndex` — that knows the
 *    limits. Time is passed in, never read, so the expiry behaviour is testable
 *    without waiting a month.
 *  - A STORE, an interface with two adapters: memory for tests, `chrome.storage`
 *    for the browser. Two adapters is what makes this a real seam rather than a
 *    hypothetical one.
 *
 * Misses are cached too. A track with no lyrics anywhere is the most expensive
 * thing this extension can look up — four services asked, nothing found — and
 * without a negative cache it would pay that cost on every single play.
 */

import type { Lyrics } from './domain/types';

export interface CacheLimits {
  readonly maxEntries: number;
  /** How long a found lyric stays worth trusting. */
  readonly hitTtlMs: number;
  /** Shorter: the catalogue moves, and a miss is cheap to correct. */
  readonly missTtlMs: number;
}

export const DEFAULT_LIMITS: CacheLimits = {
  maxEntries: 300,
  hitTtlMs: 30 * 24 * 60 * 60 * 1000,
  missTtlMs: 3 * 24 * 60 * 60 * 1000,
};

export interface CacheEntry {
  /** Null is a remembered miss, and is not the same as an absent entry. */
  readonly lyrics: Lyrics | null;
  readonly storedAtMs: number;
  readonly usedAtMs: number;
}

export type CacheIndex = Readonly<Record<string, CacheEntry>>;

export type CacheLookup =
  | { readonly hit: true; readonly lyrics: Lyrics | null }
  | { readonly hit: false };

const ABSENT: CacheLookup = { hit: false };

function isFresh(entry: CacheEntry, nowMs: number, limits: CacheLimits): boolean {
  const ttl = entry.lyrics === null ? limits.missTtlMs : limits.hitTtlMs;
  // A clock that went backwards (a system time change) must not make an entry
  // immortal, so a negative age is treated as expired rather than fresh.
  const age = nowMs - entry.storedAtMs;
  return age >= 0 && age < ttl;
}

export function readEntry(
  index: CacheIndex,
  videoId: string,
  nowMs: number,
  limits: CacheLimits = DEFAULT_LIMITS,
): CacheLookup {
  const entry = index[videoId];
  if (entry === undefined) return ABSENT;
  if (!isFresh(entry, nowMs, limits)) return ABSENT;
  return { hit: true, lyrics: entry.lyrics };
}

/**
 * Marks the entry used, which is what keeps the bound honest.
 *
 * Deliberately takes no limits: freshness is decided by `readEntry`, and a
 * touch must not resurrect an entry that has already expired.
 */
export function touchEntry(index: CacheIndex, videoId: string, nowMs: number): CacheIndex {
  const entry = index[videoId];
  if (entry === undefined) return index;
  return { ...index, [videoId]: { ...entry, usedAtMs: nowMs } };
}

export function writeEntry(
  index: CacheIndex,
  videoId: string,
  lyrics: Lyrics | null,
  nowMs: number,
  limits: CacheLimits = DEFAULT_LIMITS,
): CacheIndex {
  const next: Record<string, CacheEntry> = {
    ...index,
    [videoId]: { lyrics, storedAtMs: nowMs, usedAtMs: nowMs },
  };
  return prune(next, nowMs, limits);
}

export function prune(
  index: CacheIndex,
  nowMs: number,
  limits: CacheLimits = DEFAULT_LIMITS,
): CacheIndex {
  const fresh = Object.entries(index).filter(([, entry]) => isFresh(entry, nowMs, limits));

  if (fresh.length <= limits.maxEntries) return Object.fromEntries(fresh);

  // Over the bound: drop the least recently used. Ties on `usedAtMs` fall back
  // to the key so the eviction is deterministic rather than dependent on
  // object key order.
  fresh.sort((a, b) => a[1].usedAtMs - b[1].usedAtMs || a[0].localeCompare(b[0]));
  return Object.fromEntries(fresh.slice(fresh.length - limits.maxEntries));
}

/**
 * The read side of the store, guarded against whatever is actually on disk.
 *
 * Everything here has been through `JSON.stringify` and possibly a different
 * version of this extension, so nothing about its shape can be assumed. A
 * malformed entry is dropped rather than allowed to crash the panel on the next
 * track change.
 */
export function parseIndex(raw: unknown): CacheIndex {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const out: Record<string, CacheEntry> = {};
  for (const [videoId, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseEntry(value);
    if (entry !== null) out[videoId] = entry;
  }
  return out;
}

function parseEntry(value: unknown): CacheEntry | null {
  if (typeof value !== 'object' || value === null) return null;

  const candidate = value as Partial<CacheEntry>;
  const { storedAtMs, usedAtMs } = candidate;
  if (typeof storedAtMs !== 'number' || !Number.isFinite(storedAtMs)) return null;
  if (typeof usedAtMs !== 'number' || !Number.isFinite(usedAtMs)) return null;

  return { lyrics: parseLyrics(candidate.lyrics), storedAtMs, usedAtMs };
}

function parseLyrics(value: unknown): Lyrics | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;

  const candidate = value as Partial<Lyrics>;
  if (typeof candidate.sourceId !== 'string') return null;
  if (candidate.kind !== 'synced' && candidate.kind !== 'plain') return null;
  if (!Array.isArray(candidate.lines)) return null;

  const lines = candidate.lines.flatMap((line) => {
    if (typeof line !== 'object' || line === null) return [];
    const { timeMs, text } = line as { timeMs?: unknown; text?: unknown };
    if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return [];
    if (typeof text !== 'string') return [];
    return [{ timeMs, text }];
  });
  if (lines.length === 0) return null;

  return { sourceId: candidate.sourceId as Lyrics['sourceId'], kind: candidate.kind, lines };
}

export interface CacheStore {
  read(): Promise<unknown>;
  write(index: CacheIndex): Promise<void>;
}

export interface LyricsCache {
  get(videoId: string): Promise<CacheLookup>;
  set(videoId: string, lyrics: Lyrics | null): Promise<void>;
  clear(): Promise<void>;
}

export function createCache(
  store: CacheStore,
  now: () => number,
  limits: CacheLimits = DEFAULT_LIMITS,
): LyricsCache {
  async function load(): Promise<CacheIndex> {
    return parseIndex(await store.read());
  }

  return {
    async get(videoId) {
      const index = await load();
      const lookup = readEntry(index, videoId, now(), limits);
      if (lookup.hit) {
        // Persist the touch so the bound evicts by use rather than by age.
        await store.write(touchEntry(index, videoId, now()));
      }
      return lookup;
    },

    async set(videoId, lyrics) {
      const index = await load();
      await store.write(writeEntry(index, videoId, lyrics, now(), limits));
    },

    async clear() {
      await store.write({});
    },
  };
}

/** The store for tests and for the in-memory fallback. */
export function createMemoryStore(initial: CacheIndex = {}): CacheStore {
  let index: CacheIndex = initial;
  return {
    read: () => Promise.resolve(index),
    write: (next) => {
      index = next;
      return Promise.resolve();
    },
  };
}

const STORAGE_KEY = 'lyrics.cache.v1';

export function createChromeStore(): CacheStore {
  return {
    async read() {
      const bag = await chrome.storage.local.get(STORAGE_KEY);
      return bag[STORAGE_KEY];
    },
    async write(index) {
      await chrome.storage.local.set({ [STORAGE_KEY]: index });
    },
  };
}
