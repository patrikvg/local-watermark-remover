# Video Download (YouTube / TikTok) — Design Spec

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Project path:** `C:\Users\patrodev\watermark-remover`

## Goal

Add a local **Download** tab where the user pastes a YouTube or TikTok URL, sees the best available resolution before starting, downloads at the best possible quality (Full HD / 4K when offered), and optionally continues into the existing Watermark flow with the file already loaded.

Files never leave the machine. “Server” means the existing localhost helper.

## Users & constraints

- Same single-user Windows PC as the rest of the app (FFmpeg already on PATH).
- New dependency: **`yt-dlp` on PATH** (checked like FFmpeg).
- Platforms in v1: **YouTube and TikTok only**.
- Personal / local tooling only; respect platform terms and copyright for content you download.

## Product decisions

| Decision | Choice |
|----------|--------|
| Primary purpose | Standalone download (save best-quality file) |
| Optional watermark | Checkbox: after download, open Watermark tab with file loaded; user draws box as today |
| Quality | Always best available; **show** resolution (and title/duration/platform) after probe, before start |
| Quality dropdown | Out of scope for v1 |
| Platforms | YouTube + TikTok only |
| Playlists / batch | Out of scope |
| Auto watermark region | Out of scope (no fixed/saved box) |
| Accounts / cloud | None |

## Architecture

Reuse the existing two-process local stack:

1. **Web UI** — new **Download** tab next to Watermark and Ranking.
2. **Local API** — Fastify endpoints that spawn **`yt-dlp`** (probe + download). FFmpeg remains required for merging separate video/audio streams when yt-dlp requests it.

```
[Browser: Download tab]
   URL → POST /api/download/probe  → title, duration, best resolution, platform
   → optional checkbox “Danach Watermark entfernen” (client state only)
   → POST /api/download/start      → jobId
   → poll GET /api/download/:id    → progress / done / error
   → GET /api/download/:id/file    → save locally
   → if watermark checked: switch to Watermark with uploadId preloaded
[Local API]
   → yt-dlp (best video+audio, merge via FFmpeg)
   → store under server/downloads/ (or equivalent under paths.js)
   → register finished file into the same in-memory upload map Watermark already uses (so the Watermark tab can load by uploadId without a second file pick)
```

### Stack additions

- **yt-dlp** CLI (system binary), invoked like FFmpeg jobs today.
- No pure-JS YouTube/TikTok libraries in v1 (fragile for high quality / TikTok).

## UI flow

1. Open **Download** tab.
2. Paste URL → **Prüfen** (probe).
3. Show card: title, duration, best resolution (e.g. `3840×2160 (4K)`), platform.
4. Optional checkbox: **Danach Watermark entfernen**.
5. **Herunterladen** — progress (percent / phase such as download / merge).
6. On success: **Datei speichern**; if checkbox was on (or user clicks **Zu Watermark**), navigate to Watermark with the video already available for box drawing.

Reject non–YouTube/TikTok URLs in the UI and API before starting a job.

## Download behavior

- Probe with yt-dlp metadata (JSON / print) to determine title, duration, and best video height/width (or format resolution) without downloading the full file.
- Download with a “best video + best audio, merge” format selection so resolution and audio are both maximized when the site splits streams.
- Prefer a stable container (e.g. mp4) when practical so Watermark/FFmpeg pipelines keep working.
- Progress: surface yt-dlp progress to the client (same job-polling pattern as existing process jobs).
- Cancel: kill the subprocess and clean temp/partial outputs.

## API (v1)

| Endpoint | Role |
|----------|------|
| `GET /api/health` | Extend with `ytdlp: boolean` (keep existing ffmpeg/ffprobe/encoder fields) |
| `POST /api/download/probe` | Body `{ url }` → metadata + best resolution or 4xx |
| `POST /api/download/start` | Body `{ url }` → `{ jobId }` (watermark checkbox is UI-only) |
| `GET /api/download/:id` | Public job status / progress / error / `uploadId` when done |
| `GET /api/download/:id/file` | Stream finished file |
| Cancel | Mirror existing job cancel pattern for download jobs |

On success the download job exposes an `uploadId` that Watermark can consume the same way as `/api/upload`. Exact field names follow existing job list/public helpers where possible.

## Error handling

| Situation | Behavior |
|-----------|----------|
| yt-dlp missing / broken | Clear setup message; do not start probe/download |
| FFmpeg missing when merge needed | Fail with readable message (health already tracks FFmpeg) |
| URL not YouTube or TikTok | Reject before download |
| Private / geo / deleted / unavailable | Surface readable yt-dlp error |
| User cancels | Stop process; clean partial files |
| Disk / write failure | Report error; leave prior successful files intact |
| Unsupported URL shape | 400 with clear message |

## Testing

- Unit tests with **mocked** yt-dlp (no network downloads in automated tests):
  - URL allowlist (YouTube / TikTok accept; others reject)
  - Health reports `ytdlp`
  - Probe/start handlers map stdout / exit codes to API responses
  - Job lifecycle: running → done / error / cancel
- Manual smoke: one real YouTube and one real TikTok URL through the UI once.

No Playwright suite required for v1.

## Out of scope (v1)

- Quality picker (720p / 1080p / 4K dropdown)
- Instagram, other yt-dlp sites, playlists, batch queues
- Automatic watermark without drawing a box
- Subtitles / audio-only mode
- Cloud sync, accounts, remote processing

## Success criteria

- User can paste a YouTube or TikTok URL, see best available resolution, download at that best quality, and save the file locally.
- Optional path lands in Watermark with the file loaded so the existing box + delogo flow works unchanged.
- Missing yt-dlp or invalid platform URLs fail clearly without hanging jobs.
