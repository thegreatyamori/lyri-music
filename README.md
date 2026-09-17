# LyriMusic

A lyrics panel for YouTube Music that follows the track. Line-synced, centred and
readable, and it pops out into a picture-in-picture window you can park anywhere.

It reads lyrics from public community databases at runtime, on your own
connection. **No account, no server, no bundled lyrics** — it hosts nothing,
proxies nothing, and ships no words that belong to anyone else.

**Not affiliated with Google, YouTube, or YouTube Music.**

## Install

1. **[Download the latest release](https://github.com/thegreatyamori/lyri-music/releases/latest)** and unzip it somewhere permanent — the browser reads the files where they sit, so moving them later breaks the install.
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
3. Turn on **Developer mode**, top right.
4. **Load unpacked** → select the folder you unzipped, the one with `manifest.json` in it.
5. Open [YouTube Music](https://music.youtube.com) and play something. A panel appears bottom-right.

Requires a Chromium browser at version 116 or newer: the pop-out window uses the
Document Picture-in-Picture API.

Don't drag the ZIP or the folder onto the extensions page. That takes a signed
`.crx` and a drag-and-drop folder, respectively, and refuses both — the button is
the way.

### Build from source

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm build    # writes dist/
```

Then load `dist/` the same way as step 4 above, and reload from the extensions
page after each build.

## Using it

The toolbar icon is **settings, not lyrics** — it lists the sources this
extension may ask, and carries the switch that shows or hides the panel. The
lyrics live in the page.

| | |
| --- | --- |
| Scrolling through untimed lyrics | just scroll |
| Nudging lyrics that run early or late | the `−` / `+` in the panel footer |
| Asking the sources again | the refresh button, in the panel header and in the pop-out |
| A window you can park anywhere | the pop-out button, then drag it |

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
pnpm dev          # both builds, watching
pnpm test         # vitest
pnpm verify       # no-lyrics check → typecheck → tests → both builds
pnpm package      # verify + a release zip in the project root
pnpm preview:pip  # the pop-out window's styling, in a browser, no build needed
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
