# Download TikTok Format Checkbox — Design Spec

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Project path:** `C:\Users\patrodev\watermark-remover`  
**Extends:** `docs/superpowers/specs/2026-08-16-video-download-design.md`

## Goal

Add a **TikTok-Format** checkbox on the Download tab. When enabled, after the best-quality yt-dlp download, convert the file with FFmpeg to a vertical **9:16 / 1080×1920** center-crop at high encode quality, then offer that file for save (and optional Watermark handoff).

When the checkbox is off, behavior stays unchanged: best-quality download as today.

## Product decisions

| Decision | Choice |
|----------|--------|
| Aspect / size | Always **1080×1920** (9:16), not larger even if source is 4K |
| Crop mode | Center-crop fill (`scale=…:force_original_aspect_ratio=increase` then `crop=1080:1920`) — same idea as Ranking clips |
| Quality | High encode quality (prefer existing NVENC path when available, else libx264 at a quality-oriented preset/CRF); avoid low-bitrate “small file” settings |
| Original file | Not kept as a second downloadable artifact in v1 — output is the TikTok-format file when checkbox is on |
| Watermark + TikTok both on | Convert to TikTok format first, then open Watermark with that 9:16 file |
| Fit / letterbox | Out of scope |
| Resolution picker | Out of scope |

## UI

On the Download tab, two independent checkboxes:

1. **TikTok-Format (9:16 / 1080×1920)**  
2. **Danach Watermark entfernen** (existing)

Flow:

- Neither: download best quality → save and/or Watermark as today.  
- TikTok only: download → FFmpeg convert → save TikTok file.  
- Watermark only: download → Watermark handoff (existing).  
- Both: download → convert → Watermark handoff with converted `uploadId`.

Show progress for the convert step (e.g. phase `download` then `convert`, or a clear status line).

## Architecture

Reuse the existing download job:

```
yt-dlp (best quality)
  → if tiktokFormat:
       FFmpeg center-crop + encode → 1080×1920 mp4
  → register upload / serve file
  → optional Watermark tab with uploadId
```

### API change

`POST /api/download/start` body:

```json
{ "url": "...", "tiktokFormat": false }
```

Public job status may include:

- `tiktokFormat: boolean`
- `phase: "download" | "convert" | null` (optional but useful for UI)

## Conversion behavior

- Input: finished yt-dlp file (any resolution/aspect).  
- Filter chain (conceptually): scale to cover 1080×1920, center crop, `setsar=1`, keep audio.  
- Prefer fps/audio handling that does not needlessly re-sample unless required for a stable mp4.  
- Encoder: same preference as the rest of the app (`h264_nvenc` when available, else `libx264`) with quality-first settings suitable for Shorts/TikTok viewing (not tiny-file presets).  
- Replace/register the job output as the converted file so `/file` and Watermark media use 1080×1920.

Already-vertical sources still go through the same cover+crop path so the result is exactly 1080×1920.

## Error handling

| Situation | Behavior |
|-----------|----------|
| Convert fails after successful download | Job `error` with readable FFmpeg message; do not pretend TikTok file exists |
| User cancels during convert | Kill FFmpeg; clean partial convert outputs (and existing download cancel cleanup) |
| Missing FFmpeg | Already blocked at download start |

## Testing

- Unit test for TikTok filter/arg builder (exact 1080×1920 crop chain; encoder flags quality-oriented).  
- Download job test with mocked download + mocked convert when `tiktokFormat: true` sets final dimensions path / calls convert.  
- Manual smoke: landscape 1080p+ and one taller source with checkbox on; confirm 1080×1920 and acceptable sharpness; both checkboxes → Watermark loads vertical file.

## Out of scope (v1)

- Letterbox / fit mode  
- Keeping both original and TikTok files  
- Output larger than 1080×1920  
- Client-side conversion  

## Success criteria

- Checkbox off: identical to current Download behavior.  
- Checkbox on: saved file is 1080×1920 center-cropped, looks sharp (not heavily compressed).  
- Both checkboxes on: Watermark opens with the TikTok-format video ready for box drawing.
