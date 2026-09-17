# CONTEXT.md — LyriMusic

Domain vocabulary and the rules that the code is expected to follow. Read this
before changing anything; the architecture below is deliberate and load-bearing.

## What this is

A Manifest V3 extension for Chromium browsers that shows lyrics for whatever is
playing on YouTube Music, highlighting the current line as the track plays. It
reads lyrics from third-party community databases at runtime, on the user's own
connection. It hosts nothing, proxies nothing, and ships no lyrics.

## Vocabulary

Use these terms in code, comments and commits. They are the seams.

| Term | Meaning |
| --- | --- |
| **Track Query** | `TrackQuery` — the identity of a recording as a provider sees it: cleaned title, artist, album, duration, and the video id. One value, passed whole. |
| **Now Playing** | The seam over YouTube Music. `NowPlayingSource` — metadata plus position, with two adapters behind it (Media Session, page DOM). |
| **Lyric Clock** | Turns "playback position" into "which line is current". Receives the lines and an offset; exposes `lineAt(t)`. Pure, no DOM. |
| **Lookup** | Resolving a `TrackQuery` to `Lyrics`: asks the enabled providers at the same time, hands back answers in priority order. |
| **Provider** | A module that knows one lyrics service. Implements `LyricsProvider`. Knows nothing about order, cache or UI. |
| **Source Badge** | The small label saying which provider the visible lyrics came from. |
| **Overlay** | The in-page panel. The PiP window and the popup are two more presentations of the same lyrics. |

## Architecture rules

These were chosen for testability and to keep the fragile parts isolated. Do not
undo them casually.

1. **All network access happens in the background module**, never in the content
   script. A content script's `fetch` is subject to the page's CORS; the
   background module is not. The content script sends messages.
2. **The Lookup is the deep module.** Order, cache, backoff, cancellation and
   the provider fan-out live behind `lookup(query)`. The background module is a
   thin adapter from `chrome.runtime.onMessage` to it.
3. **The provider registry is data, not control flow.** No `switch` on source id
   anywhere in the Lookup. Adding a provider is a new file plus a registry row.
4. **Two adapters or it is not a seam.** `NowPlayingSource` has the Media
   Session and the DOM adapters; the cache has a memory and a `chrome.storage`
   adapter. A fake is what makes the rest testable.
5. **The Lyric Clock is pure.** It never touches the DOM or `chrome`. The view
   drives it and reads it; it does not know a view exists.
6. **Providers never throw to report a miss.** A provider with nothing returns
   `null`. A deliberate "not found" is not an exception.
7. **Offline-first for the current track.** Lookups are cached by video id, and a
   miss is cached too, so a track without lyrics is not re-asked forever.

## Layout

```
src/
  lib/
    domain/        types.ts (vocabulary), lyrics.ts (LRC → Lyrics)
    providers/     provider.ts (the interface), one module per source, index.ts (registry)
    lookup.ts      the deep module: fan-out, order, cache, backoff
    cache.ts       adapter over chrome.storage.local + a memory adapter
    query.ts       YouTube title/artist → search-ready Track Query
    lyric-clock.ts position → current line. Pure: no DOM, no chrome
    now-playing.ts composition of adapters (pure, testable with fakes)
  background/      worker.ts — adapter over lookup
  content/         index.tsx (mounts the Overlay), now-playing.ts (the two adapters), Overlay.tsx
  pip/             the PiP window, another presentation of the same lines
  popup/           the toolbar popup
  styles/          tokens.css, panel.css
```

## Conventions

- **Strict TypeScript.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  and `verbatimModuleSyntax` are on. Index access yields `T | undefined` — handle
  it rather than asserting. Use `import type` for types. Prefer `| null` over
  optional properties.
- **No lyrics in the repository, ever.** Not in fixtures, not in tests, not in
  screenshots, not in a sample JSON. Tests use invented text. `pnpm check:no-lyrics`
  enforces the mechanical part of this; do not work around it.
- **Comments say why.** A comment that restates the code is noise. A comment that
  records a constraint, a limit of a provider, or a reason not to do the obvious
  thing is the point.
- **Provider modules are independent.** They share `LyricsProvider`, `TrackQuery`,
  `Lyrics`, and the two builders in `domain/lyrics.ts`. They do not import each
  other and do not import the Lookup.
- **Every provider honours `AbortSignal`.** The losers of a lookup are cancelled.

## Build

Two Vite builds, because Manifest V3 content scripts cannot be ES modules:

- `vite build` — the popup page and the background module, as ESM.
- `vite build -c vite.content.config.ts` — the content script, as one IIFE.

`src` is the Vite root, `public/` is copied verbatim (the manifest and icons),
output lands in `dist/`. Load `dist/` unpacked.

## Verify

```
pnpm verify      # no-lyrics check → typecheck → tests → both builds
pnpm test        # vitest, node environment
```

## Out of scope for v1

Word-level (syllable) timing, Genius, Musixmatch, reusing YouTube's own lyrics
endpoint, UI translations, any server-side component, publishing to the Chrome
Web Store.
