# Watermark Remover — Design Spec

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Project path:** `C:\Users\patrodev\watermark-remover`

## Goal

A local web app where the user uploads a video (including 4K), draws a box over a static watermark (snipping-tool style), processes the file on their machine, and downloads a cleaned video. Watermark removal quality is the top priority: the mark should be gone and the patch should look as natural as practical (not AI-perfect reconstruction).

Nothing is uploaded to the internet. Auto-detect of watermarks is explicitly out of scope for v1.

## Users & constraints

- Single user on one powerful Windows PC (AMD Ryzen 7 7800-class CPU, NVIDIA RTX 5070 Ti).
- FFmpeg is already available on the machine.
- Videos may be 4K; browser-only WASM processing is rejected for v1 because it does not reliably use the GPU and struggles with 4K memory/time.
- Watermarks are mostly static (corners or center), sometimes slightly translucent.

## Product decisions

| Decision | Choice |
|----------|--------|
| Region selection | Manual draw / move / resize box (v1) |
| Auto-detect | Deferred |
| Processing location | Local helper process on the PC |
| Removal method | FFmpeg region fill (delogo-style) every frame |
| Quality bar | “Gone + not obviously patched”; soft blend OK on hard cases |
| Audio | Preserve original audio |
| Resolution | Preserve source resolution (including 4K) |
| Accounts / cloud | None |

## Architecture

Two local components:

1. **Web UI** (browser) — upload, preview, scrub to a frame, draw box, start job, show progress, download result.
2. **Local processor** — accepts video + box coordinates `(x, y, width, height)`, runs FFmpeg to fill that region on all frames, re-encodes (prefer NVIDIA hardware encode when available), returns the output file path.

```
[Browser UI] --HTTP localhost--> [Local API] --subprocess--> [FFmpeg + NVENC if available]
       |                              |
   file pick / box coords        temp input/output on disk
```

Files never leave the machine; “server” means a local helper bound to localhost.

### Stack

- **Frontend:** Vite + React — video preview, canvas overlay for the snipping box.
- **Backend:** Node (Fastify or Express) on localhost — upload/job API, spawns FFmpeg, streams progress.
- **Media:** system FFmpeg; prefer `h264_nvenc` / `hevc_nvenc` when the GPU encoder works, with software encode fallback.

## UI flow

1. Drop or choose a video file.
2. Preview the video; scrub to a frame where the watermark is clear.
3. Draw a rectangle over the watermark (drag like Snipping Tool; allow move/resize).
4. Click **Remove watermark**; show progress (and allow cancel).
5. Download the cleaned file.

v1 extras: show selected region size, clear errors (unsupported format, FFmpeg missing, cancel, disk issues). No auth, no cloud UI, no auto-detect.

## Removal behavior

- Apply FFmpeg delogo-style fill to the user box for every frame.
- Apply a small default edge band so the filled region does not look hard-cut.
- Keep audio; keep resolution and (as far as practical) frame rate.
- Large center marks or busy motion under the mark may look softly smudged — accepted for v1.
- Watermarks that move outside the drawn box are not fully removed unless the box covers their path.

## Error handling

| Situation | Behavior |
|-----------|----------|
| FFmpeg not found / broken | Clear setup message; do not start job |
| Unsupported / corrupt media | Reject with readable error |
| User cancels | Stop process; clean temp outputs |
| Disk / write failure | Report error; leave input intact |
| NVENC unavailable | Fall back to software encode and note it in logs/UI if useful |

## Out of scope (v1)

- Automatic watermark detection
- Cloud processing or accounts
- Batch queue of many files
- Perfect generative AI inpainting
- Mobile-first layout polish
- Removing watermarks that freely move across the frame without a covering box

## Success criteria

- User can process a 4K sample on this machine end-to-end without uploading remotely.
- Corner/static watermarks inside the drawn box are no longer readable/visible in normal viewing.
- Result downloads and plays with audio.
- Cancel and common failures produce clear messages.

## Future (explicitly later)

- Optional auto-detect + user fine-tune of the box.
- Stronger inpainting path if delogo quality is insufficient on translucent marks.
- Batch jobs and presets for common corner sizes.
