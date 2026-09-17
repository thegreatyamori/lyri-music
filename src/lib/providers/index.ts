/**
 * The provider registry.
 *
 * This is DATA, not control flow. The lookup iterates this array; nothing
 * anywhere switches on a source id. Adding a source is a module plus one line
 * here, and requires no edit to the lookup.
 *
 * Order is the default priority, and it is the order of the array below:
 * timed sources before untimed ones, and within the timed ones, the open,
 * documented API before the unofficial ones. `enabledByDefault` is a separate
 * question — a source can be worth trying first and still be off until the
 * user opts in, which is exactly the case for the unofficial two.
 */

import type { LyricsProvider } from './provider';
import { kugou } from './kugou';
import { lrclib } from './lrclib';
import { lyricsovh } from './lyricsovh';
import { netease } from './netease';

export const PROVIDERS: readonly LyricsProvider[] = [lrclib, kugou, netease, lyricsovh];

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function providerById(id: string): LyricsProvider | undefined {
  return BY_ID.get(id as LyricsProvider['id']);
}

/** The providers a user gets before touching any setting. */
export function defaultProviders(): LyricsProvider[] {
  return PROVIDERS.filter((provider) => provider.enabledByDefault);
}

export type { LyricsProvider };
