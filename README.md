# LyriMusic

A Manifest V3 extension for Chromium browsers that shows lyrics for whatever is
playing on YouTube Music, following the track as it plays.

It reads lyrics from third-party community databases at runtime, on your own
connection. It hosts nothing, proxies nothing, and ships no lyrics.

**Not affiliated with Google, YouTube, or YouTube Music.**

## Status

Early. The scaffold, the domain contracts, the LRC parser and the icon set are
in place; the providers, the clock and the panel are being built.

## Install

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm build
```

Then, in your browser:

1. Open `chrome://extensions` (or `brave://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select the `dist/` directory.
4. Open [YouTube Music](https://music.youtube.com) and play something.

Reload the extension from the extensions page after each build.

## Sources

| Source | Timing | Default | Access |
| --- | --- | --- | --- |
| [LRCLIB](https://lrclib.net) | line | on | open, documented API |
| [lyrics.ovh](https://lyrics.ovh) | none | on | open API |
| [KuGou](https://www.kugou.com) | line | **off** | unofficial |
| [NetEase](https://music.163.com) | line | **off** | unofficial |

KuGou and NetEase are off by default: their access is unofficial, so the choice
to contact them is yours. A track with no lyrics on any source is a normal
outcome, not an error.

## What it deliberately does not do

No backend, no proxy, no central cache. No analytics, accounts or telemetry. No
lyrics in this repository. No word-level timing yet. No Chrome Web Store
release.

## Development

```bash
pnpm dev        # both builds, watching
pnpm test       # vitest
pnpm verify     # no-lyrics check → typecheck → tests → both builds
pnpm package    # verify + a release zip in the project root
```

Two Vite builds are needed because Manifest V3 content scripts are not ES
modules: the pages and the background module build as ESM, the content script
as a single IIFE. See `CONTEXT.md` for the architecture and the domain
vocabulary, and `CONTRIBUTING.md` before opening a pull request.

## Rights holders

This project contains no lyrics. Each user's browser fetches them at runtime and
keeps them, at most, in that browser's local storage. If you would rather a
particular source not be contacted at all, open an issue — disabling or deleting
a source is a small change, and it will be made. See `DISCLAIMER.md`.

## License

MIT for the source code — see `LICENSE`. Lyrics are the property of their
respective rights holders and are not covered by it. See `NOTICE`.
