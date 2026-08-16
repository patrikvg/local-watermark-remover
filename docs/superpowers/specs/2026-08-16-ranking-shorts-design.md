# Ranking Shorts Module — Design Spec

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Project:** `C:\Users\patrodev\watermark-remover` (same repo, separate module)

## Goal

Add a **Ranking** module next to the existing Watermark Remover. Users upload exactly **5 clips**, set order (places 5→1), place a movable title, choose audio options, preview in **9:16**, and export **one vertical Shorts/TikTok-style video** where rank numbers fly in from the left and **stack** as each clip plays.

Watermark removal stays an independent module with no shared editing flow.

## Product decisions

| Decision | Choice |
|----------|--------|
| Placement | Same local app; separate page/nav item (`Watermark` \| `Ranking`) |
| Clip count | Exactly 5 |
| Clip duration | Full length of each upload (no trim in v1) |
| Output | Always vertical **9:16** (center-crop / letterbox fit as needed) |
| Order | User drag-reorder; maps to ranks 5 (first segment) → 1 (last) |
| Numbers | Start empty; on each new clip segment, that rank flies in from the **left** and stays; previous ranks remain (stack) |
| Title | Single text string; drag to position in preview; burned into export |
| Audio | (1) Keep clip audio + optional BGM under, or (2) mute clips + BGM only |

## Architecture

Reuse the existing local stack:

1. **Frontend (Vite + React)** — Ranking editor UI + 9:16 preview.
2. **Local API (Fastify)** — upload clips/music, start export job, progress, download.
3. **FFmpeg** — scale/crop to 9:16, concatenate clips, overlay title + animated/stacked rank numbers, mix audio, encode (prefer NVENC with software fallback).

```
[Ranking UI] --localhost--> [API] --FFmpeg--> [9:16 ranking.mp4]
[Watermark UI] (unchanged, separate routes)
```

## UI flow

1. Navigate to Ranking.
2. Upload 5 video clips into slots.
3. Drag to set order (defines which clip is #5 … #1).
4. Enter title; drag title on the 9:16 preview.
5. Choose audio: clip sound on/off; optional background music file.
6. Preview playback (clips back-to-back; numbers stack from the left).
7. Export → progress → download.

Block export with a clear message if fewer or more than 5 clips are ready, or if FFmpeg is missing.

## Visual / animation (v1)

- Large readable rank digits along the left side.
- At the start of each clip segment, the new digit animates in from the left (~0.3–0.6s), then remains for the rest of the video.
- Title stays at the user-chosen position for the whole video.
- Clips fill 9:16; center-crop when aspect differs.

## Audio (v1)

- **Mode A:** Clip audio preserved through concatenate; optional BGM mixed under (user-settable relative level with a simple default).
- **Mode B:** Clip audio muted; BGM only (BGM required in this mode).
- If BGM is shorter than the video, loop it; if longer, cut to video length.

## Error handling

| Situation | Behavior |
|-----------|----------|
| Not exactly 5 clips | Disable export; explain |
| Bad/corrupt media | Reject upload with readable error |
| FFmpeg missing | Same health banner pattern as Watermark |
| Export cancel | Kill job; clean temp outputs |
| NVENC fail | Fall back to libx264 |

## Out of scope (v1)

- Trimming clips
- Custom fonts / stickers / particles
- Counts other than 5
- Cloud upload
- Auto-detect ranks from content
- Any coupling to watermark removal logic

## Success criteria

- User can build and download a 9:16 ranking Short from 5 local clips without leaving the machine.
- Rank numbers appear in order 5→1, stacking, flying in from the left at each segment start.
- Title position in export matches preview.
- Both audio modes work.
- Watermark module remains usable and separate.

## Future (later)

- Trim in/out per clip
- Custom fonts and number styles
- Variable list length (Top 3 / Top 10)
- Stronger preview↔export pixel parity tools
