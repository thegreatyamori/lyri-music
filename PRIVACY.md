# Privacy

## Short version

LyriMusic collects nothing. It has no server, no analytics, no telemetry, no
accounts, and no remote code. Everything it knows stays on the device.

## What is stored, and where

| Data | Where | Why | Lifetime |
| --- | --- | --- | --- |
| Lookup results (lyrics lines) | `chrome.storage.local` | So a track you replay does not hit four services again | Until evicted by the cache bound, or you clear extension data |
| Lookup misses | `chrome.storage.local` | So a track with no lyrics is not re-asked forever | Shorter than hits; same eviction |
| Your source order and toggles | `chrome.storage.local` | Your preferences | Until changed |
| Panel position and offset tweak | `chrome.storage.local` | Your preferences | Until changed |

All of it is local to your browser profile. None of it is synced, and none of it
leaves the device.

## What leaves the device

One thing, and only when you play something: a **lyrics search** — the track
title, artist, album and duration — sent to the lyrics providers you have
enabled. That is the same information you would type into a search box on those
sites. It is sent directly from your browser to them; this project never sees it
and has no server that could.

Providers and what they receive:

| Provider | Default | Notes |
| --- | --- | --- |
| LRCLIB | On | `lrclib.net` |
| lyrics.ovh | On | `api.lyrics.ovh` |
| KuGou | **Off** | `lyrics.kugou.com` — unofficial |
| NetEase | **Off** | `music.163.com` — unofficial |

Those services have their own privacy policies. This project does not control
them.

## Permissions

- `storage` — for the local cache and preferences above.
- Host access to the four provider domains, and to `music.youtube.com` so the
  panel can be injected there.

No `tabs`, no `webRequest`, no `cookies`, no broad host access, no remote code.

## Contact

Open an issue on the repository.
