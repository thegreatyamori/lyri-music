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

import type { Lyrics, TrackQuery } from './domain/types';

/**
 * What the cache is addressed by.
 *
 * NOT the video id on its own, and that is the whole point. A track's id comes
 * from the url and is known the instant the song changes, while the title and
 * artist come from the page and lag behind it — so a lookup can go out pairing
 * the new id with the previous song's name. Under an id-only key that wrong
 * answer would then be served for the *right* question too, for as long as it
 * lived, and the panel would show the previous song's words indefinitely.
 *
 * The key is therefore the QUESTION — which recording, asked which way — so a
 * better question is a different entry and a stale answer can never shadow a
 * correct one. Replaying the same track asks the same question and still hits.
 */
export function cacheKeyFor(query: TrackQuery): string {
  return [query.videoId, normalizeKeyPart(query.title), normalizeKeyPart(query.artist)].join('|');
}

function normalizeKeyPart(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

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
  key: string,
  nowMs: number,
  limits: CacheLimits = DEFAULT_LIMITS,
): CacheLookup {
  const entry = index[key];
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
export function touchEntry(index: CacheIndex, key: string, nowMs: number): CacheIndex {
  const entry = index[key];
  if (entry === undefined) return index;
  return { ...index, [key]: { ...entry, usedAtMs: nowMs } };
}

export function writeEntry(
  index: CacheIndex,
  key: string,
  lyrics: Lyrics | null,
  nowMs: number,
  limits: CacheLimits = DEFAULT_LIMITS,
): CacheIndex {
  const next: Record<string, CacheEntry> = {
    ...index,
    [key]: { lyrics, storedAtMs: nowMs, usedAtMs: nowMs },
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
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseEntry(value);
    if (entry !== null) out[key] = entry;
  }
  return out;
}

function parseEntry(value: unknown): CacheEntry | null {
  if (typeof value !== 'object' || value === null) return null;

  const candidate = value as Partial<CacheEntry>;
  const { storedAtMs, usedAtMs } = candidate;
  if (typeof storedAtMs !== 'number' || !Number.isFinite(storedAtMs)) return null;
  if (typeof usedAtMs !== 'number' || !Number.isFinite(usedAtMs)) return null;

  // Absent or null is a remembered miss, which is a legitimate thing to have
  // stored. Anything else that fails to parse is corruption, and the WHOLE entry
  // is dropped rather than degraded to a null: turning a damaged record into a
  // null would silently promote it to a confident "this track has no lyrics",
  // and a remembered miss is the most expensive thing in here to be wrong about.
  if (candidate.lyrics === null || candidate.lyrics === undefined) {
    return { lyrics: null, storedAtMs, usedAtMs };
  }

  const lyrics = parseLyrics(candidate.lyrics);
  return lyrics === null ? null : { lyrics, storedAtMs, usedAtMs };
}

/** Null means unreadable, which is not the same as a miss. */
function parseLyrics(value: unknown): Lyrics | null {
  if (typeof value !== 'object' || value === null) return null;

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
  /** The key is a question key from `cacheKeyFor`, not a bare video id. */
  get(key: string): Promise<CacheLookup>;
  set(key: string, lyrics: Lyrics | null): Promise<void>;
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
    async get(key) {
      const index = await load();
      const lookup = readEntry(index, key, now(), limits);
      if (lookup.hit) {
        // Persist the touch so the bound evicts by use rather than by age.
        await store.write(touchEntry(index, key, now()));
      }
      return lookup;
    },

    async set(key, lyrics) {
      const index = await load();
      await store.write(writeEntry(index, key, lyrics, now(), limits));
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

/**
 * Bumped to v2 when the key changed from a bare video id to a question key.
 *
 * v1 entries are not migrated and not read: every one of them was addressed by
 * video id alone, which is the shape that let a lookup answer for the previous
 * song be filed under the new one. Those answers are indistinguishable from good
 * ones from the outside, so the honest thing is to leave them behind rather than
 * carry them forward. The stale blob stays in storage until the browser is asked
 * to clear it, which costs a few hundred kilobytes and misleads nobody.
 */
const STORAGE_KEY = 'lyrics.cache.v2';

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
