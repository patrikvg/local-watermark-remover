# Local File → TikTok Format Tab — Design Spec

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Project path:** `C:\Users\patrodev\watermark-remover`  
**Extends:** `docs/superpowers/specs/2026-08-16-download-tiktok-format-design.md` (same 1080×1920 convert)

## Goal

Add a dedicated nav tab **TikTok Format** where the user drops or picks a local video file, converts it to vertical **9:16 / 1080×1920** (center-crop, high-quality encode), downloads the result, and optionally continues into the Watermark tab with that file loaded.

URL / yt-dlp stays on the existing **Download** tab only.

## Product decisions

| Decision | Choice |
|----------|--------|
| Placement | New top-nav tab **TikTok Format** (separate from Download) |
| Input | Local video file only (drag-drop + file picker) |
| Convert | Same as Download TikTok checkbox: center-crop cover to **1080×1920**, high encode quality via `buildTiktokFormatArgs` |
| Watermark | Optional checkbox **Danach Watermark entfernen** → handoff with `uploadId` |
| Keep original | Out of scope — output is the converted file |
| Batch | Out of scope (one file at a time) |
| Letterbox / other sizes | Out of scope |

## UI flow

1. Open **TikTok Format** tab.  
2. Drop or choose a video.  
3. Optional: **Danach Watermark entfernen**.  
4. Start convert → show progress (and cancel).  
5. On success: **Datei speichern**; if watermark checked (or via button), open Watermark with converted upload.

Show clear errors if FFmpeg missing or file unreadable. Health banner can require ffmpeg/ffprobe (yt-dlp not required for this tab).

## Architecture

```
[Browser: TikTok Format tab]
   file → POST multipart upload
   → job convert (FFmpeg buildTiktokFormatArgs)
   → poll status → GET file / Watermark uploadId
[Local API]
   store under downloads/ or dedicated tiktok/ dir
   register finished file into uploads map (same as Download)
```

Reuse:

- `server/src/tiktokFormat.js` — arg builder (no second crop implementation)  
- Encoder preference from existing `cachedEncoder` (NVENC / libx264)  
- Watermark handoff pattern from Download (`uploadId` + `/api/uploads/:id/media`)

### API (v1)

| Endpoint | Role |
|----------|------|
| `POST /api/tiktok/upload` | Multipart video → create convert job → `{ jobId }` (or `{ uploadId, jobId }` if split) |
| `GET /api/tiktok/:id` | Public job status / progress / error / `uploadId` when done |
| `POST /api/tiktok/:id/cancel` | Cancel |
| `GET /api/tiktok/:id/file` | Stream finished 1080×1920 file |

Prefer a small dedicated job module (e.g. `tiktokJobs.js`) that only runs convert, rather than overloading URL download jobs. Call the same `buildTiktokFormatArgs`.

Alternative acceptable shape: `POST /api/tiktok/upload` stores file + returns id, then `POST /api/tiktok/start` — only if it keeps the UI as one click after drop. Preferred UX: drop/pick starts convert automatically or with one **Konvertieren** button.

**Preferred UX:** after file selected, user clicks **Konvertieren** (or auto-start is OK if progress is obvious). Checkbox for watermark is set before or during.

## Conversion behavior

Identical to Download TikTok path:

- `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1`  
- High-quality NVENC (`-cq 18`) or libx264 (`-crf 17`, `medium`)  
- AAC audio, mp4 + faststart  
- Register result into `uploads` for Watermark

## Error handling

| Situation | Behavior |
|-----------|----------|
| FFmpeg/ffprobe missing | Banner + 503; do not start |
| Corrupt / non-video | Reject upload with readable error |
| Convert fails | Job `error` with FFmpeg message |
| Cancel | Kill process; clean partial outputs |

## Testing

- Reuse `tiktokFormat.test.js` (already covers args).  
- Unit tests for tiktok job lifecycle with mocked FFmpeg runner (queued → convert → done / cancel).  
- Manual: drop a landscape mp4 → get 1080×1920; watermark checkbox opens Watermark with vertical file.

## Out of scope (v1)

- URL download on this tab  
- Multiple files / queue  
- Fit/letterbox mode  
- Resolution other than 1080×1920  

## Success criteria

- User can convert a local video to sharp 1080×1920 TikTok format without using a URL.  
- Optional Watermark path works with the converted file.  
- Download tab behavior unchanged.
