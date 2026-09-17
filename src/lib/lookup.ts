/**
 * The Lookup — the deep module of this project.
 *
 * Everything expensive lives behind one call: which providers to ask, in what
 * order, in parallel, how long to wait, what counts as a better answer, what to
 * remember, and how to cancel the losers. Callers get lyrics or they get
 * nothing; they never see a promise that is still pending or a provider that
 * threw.
 *
 * Two decisions are worth stating because they look like details and are not:
 *
 *  - Every provider is asked AT THE SAME TIME, but their answers are consumed in
 *    priority order. Awaiting them one after another would make a track that no
 *    source knows cost one round trip per source before giving up. Running them
 *    together and consuming in order means a miss costs whatever the slowest
 *    source needed, once.
 *
 *  - A timed answer beats an untimed one regardless of priority. A plain-text
 *    lyric from the highest-priority source is kept only as a fallback while the
 *    rest of the list is still asked for something the panel can follow.
 */

import type { LyricsCache } from './cache';
import { cacheKeyFor } from './cache';
import type { Lyrics, SourceId, TrackQuery } from './domain/types';
import type { LyricsProvider } from './providers/provider';

export interface LookupResult {
  readonly lyrics: Lyrics;
  readonly sourceId: SourceId;
}

export interface LookupDeps {
  readonly providers: readonly LyricsProvider[];
  readonly cache: LyricsCache;
  /**
   * Total budget for the fan-out. An empty panel is a better failure than a
   * panel that stays empty while one unreachable host times out on its own.
   */
  readonly deadlineMs?: number;
  /**
   * Ignore what the cache already remembers and ask the providers again.
   *
   * A remembered miss is a legitimate answer — it is what stops a track with no
   * lyrics from costing four lookups on every play — but it is also
   * indistinguishable, from the panel, from a lookup that simply failed. This is
   * the deliberate way out, and the only one.
   */
  readonly force?: boolean;
}

export const DEFAULT_DEADLINE_MS = 8_000;

type Settled = { readonly lyrics: Lyrics | null };

export async function lookup(
  query: TrackQuery,
  deps: LookupDeps,
): Promise<LookupResult | null> {
  // The key is the question, not the video — see `cacheKeyFor`. A track whose
  // title has only just been reported is a different question from the same
  // track asked correctly a moment later, and the two must not share an answer.
  const key = cacheKeyFor(query);

  if (deps.force !== true) {
    const cached = await deps.cache.get(key);
    if (cached.hit) {
      // A remembered miss is an answer too, and the cheapest one there is.
      return cached.lyrics === null
        ? null
        : { lyrics: cached.lyrics, sourceId: cached.lyrics.sourceId };
    }
  }

  const result = await race(query, deps);

  // A hit is always worth remembering. A miss is worth remembering only when the
  // question was complete: a lookup that ran before the track's length was known
  // says very little about whether lyrics exist, and storing that answer would
  // keep the panel empty over a conclusion nobody actually reached.
  if (result !== null || query.durationMs > 0) {
    await deps.cache.set(key, result?.lyrics ?? null);
  }

  return result;
}

async function race(query: TrackQuery, deps: LookupDeps): Promise<LookupResult | null> {
  const { providers } = deps;
  if (providers.length === 0) return null;

  const controller = new AbortController();
  const deadline = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;

  /**
   * The deadline is raced, not merely signalled.
   *
   * Aborting the controller is a request to stop, and a provider that does not
   * listen to it would leave the loop awaiting that promise forever — a budget
   * that only holds against cooperative code is not a budget. Racing it makes
   * the deadline hard: once it fires, every remaining await resolves at once and
   * the lookup reports whatever it already has.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Settled>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ lyrics: null });
    }, deadline);
  });

  try {
    const jobs = providers.map((provider) => ({
      sourceId: provider.id,
      settled: ask(provider, query, controller.signal),
    }));

    let fallback: LookupResult | null = null;

    for (const job of jobs) {
      const { lyrics } = await Promise.race([job.settled, expired]);
      if (lyrics === null || lyrics.lines.length === 0) continue;

      if (lyrics.kind === 'synced') return { lyrics, sourceId: job.sourceId };
      fallback ??= { lyrics, sourceId: job.sourceId };
    }

    return fallback;
  } finally {
    // Nobody still in flight is worth waiting on, and this module will not
    // return while a provider is. Cancelling here is what makes the signal
    // meaningful rather than decorative.
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

/**
 * One provider, never allowed to reject.
 *
 * A provider is third-party code reached over a third-party network. A throw
 * from it is a miss, not an exception the caller should have to handle — and the
 * interface says so, which makes this belt-and-braces rather than the contract.
 */
async function ask(
  provider: LyricsProvider,
  query: TrackQuery,
  signal: AbortSignal,
): Promise<Settled> {
  try {
    return { lyrics: await provider.fetch(query, signal) };
  } catch {
    return { lyrics: null };
  }
}
