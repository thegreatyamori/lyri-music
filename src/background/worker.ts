/**
 * The background module.
 *
 * Deliberately thin. It is an adapter from `chrome.runtime.onMessage` to the
 * Lookup, and it holds nothing about fan-out, ordering, caching or retries —
 * all of that is behind `lookup()`.
 *
 * ALL network access in this extension happens here, and that is the reason
 * this module exists at all. A content script's `fetch` is subject to the page's
 * CORS policy; this module's is not, because it fetches under the extension's
 * own host permissions. The content script therefore sends a message and never
 * touches a lyrics host.
 *
 * Nothing is kept in module scope that matters, because Manifest V3 terminates
 * this worker at will. The cache reads from `chrome.storage` on every call for
 * exactly that reason.
 */

import { createCache, createChromeStore } from '../lib/cache';
import type { SourceId, TrackMetadata, TrackQuery } from '../lib/domain/types';
import { lookup } from '../lib/lookup';
import { isRequest, type Request, type Response } from '../lib/messages';
import { PROVIDERS, defaultProviders } from '../lib/providers';
import { artistForLyricsSearch, forLyricsSearch, splitArtistPrefix } from '../lib/query';

const SETTINGS_KEY = 'settings.enabled';

const cache = createCache(createChromeStore(), () => Date.now());

/**
 * Which sources the user has left on.
 *
 * An explicit empty array is honoured: somebody who turned everything off wants
 * no lyrics, which is a legitimate preference and not a reason to quietly
 * restore the defaults. Only a missing setting falls back.
 */
async function enabledProviders() {
  const bag = await chrome.storage.local.get(SETTINGS_KEY);
  const stored: unknown = bag[SETTINGS_KEY];

  if (!Array.isArray(stored)) return defaultProviders();

  const ids = new Set(stored.filter((value): value is string => typeof value === 'string'));
  return PROVIDERS.filter((provider) => ids.has(provider.id));
}

/**
 * What the page reports, turned into something a lyrics database can be asked.
 *
 * The title's own "Artist - Song" prefix wins over the page's byline when it
 * exists: on YouTube Music the byline is frequently the uploader or the label
 * rather than the performing artist, while the title's prefix is almost always
 * the artist the catalogue knows.
 */
function toQuery(track: TrackMetadata): TrackQuery {
  const split = splitArtistPrefix(track.title);
  return {
    videoId: track.videoId,
    title: forLyricsSearch(split.title),
    artist: artistForLyricsSearch(split.artist ?? track.artist),
    album: track.album,
    durationMs: track.durationMs,
    // Only a downloaded or previously resolved file can supply one; the page
    // never does.
    isrc: null,
  };
}

async function handle(request: Request): Promise<Response> {
  switch (request.type) {
    case 'lyrics/for-track': {
      const result = await lookup(toQuery(request.track), {
        providers: await enabledProviders(),
        cache,
        force: request.force,
      });

      // One line per lookup, so that "the panel is empty" can be told apart
      // from "the lookup never ran" without a debugger.
      console.info('[LyriMusic] lookup', {
        videoId: request.track.videoId,
        force: request.force,
        found: result !== null,
        source: result?.sourceId ?? null,
        lines: result?.lyrics.lines.length ?? 0,
      });

      return {
        type: 'lyrics/answer',
        videoId: request.track.videoId,
        lyrics: result?.lyrics ?? null,
        sourceId: result?.sourceId ?? null,
      };
    }

    case 'settings/get':
      return { type: 'settings/answer', enabled: (await enabledProviders()).map(byId) };

    case 'settings/set': {
      await chrome.storage.local.set({ [SETTINGS_KEY]: request.enabled });
      return { type: 'settings/answer', enabled: request.enabled };
    }
  }
}

function byId(provider: { id: SourceId }): SourceId {
  return provider.id;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isRequest(message)) return false;

  // `handle` cannot reject — every provider miss is already a null — but the
  // panel must never be left waiting on a message that never arrives, so this
  // is the one place that has to be sure.
  handle(message)
    .catch((): Response => ({ type: 'settings/answer', enabled: [] }))
    .then(sendResponse);

  // Keeps the channel open for the async reply.
  return true;
});
