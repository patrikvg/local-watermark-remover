# LaMa Box Inpaint — Design Spec

**Date:** 2026-08-17  
**Status:** Approved for planning  
**Project path:** `C:\Users\patrodev\watermark-remover`  
**Extends:** `docs/superpowers/specs/2026-08-16-watermark-remover-design.md`

## Goal

Replace FFmpeg `delogo` as the default watermark-removal path with local **LaMa inpainting on the user-drawn box only**. The patched region should look like surrounding video, not a smeared rectangle. Processing stays on the PC. Quality is “clearly better than delogo,” not ProPainter-perfect.

## Users & constraints

- Same single-user Windows PC (Ryzen 7 7800-class, RTX 5070 Ti).
- Mix of marks: TikTok username/logo, YouTube-style logos, large center overlays; often semi-transparent.
- Same box UI; one **Remove watermark** button.
- Extra local setup is acceptable: Python + pip + one model download (~200 MB).
- 4K source must stay practical by inpainting the crop, not the full frame.

## Product decisions

| Decision | Choice |
|----------|--------|
| Method | LaMa inpaint on box crop + feathered overlay |
| UI | Unchanged draw-box flow; no second “fast delogo” button |
| Missing engine | Do **not** silently fall back to delogo; block with setup instructions |
| GPU | CUDA when available; CPU fallback (slow) with a visible note |
| Audio / resolution / fps | Preserve as today (re-encode video, AAC audio, same frame size) |
| Moving marks | Only pixels inside the drawn box; same as v1 |
| Network | Only the first-run model download (or user copies the file into the model folder) |

## Architecture

```
[Watermark tab] -- box + uploadId --> [Local API]
                                         |
                    crop (FFmpeg) --> [Python LaMa worker] --> overlay (FFmpeg + NVENC)
                                         |
                                    health: inpaint ready / missing
```

Node keeps uploads, job state, progress, cancel, encode. Python only inpaints frames of the cropped region.

### New / changed units

| Unit | Responsibility |
|------|----------------|
| `server/src/inpaintRegion.js` | From user box + video size: crop rect, inner mask rect, feather width. All even, in-frame. |
| `server/src/ffmpegArgs.js` | Add crop-extract args and overlay-composite args (keep existing delogo builder unused by the process route). |
| `server/src/jobs.js` | Three-phase job: crop → worker → overlay/encode. Track the active child so cancel kills it. |
| `server/src/inpaint.js` | Resolve Python binary, run `--check`, spawn worker, parse frame progress. |
| `server/inpaint/worker.py` | Read crop video + mask PNG, LaMa each frame, write filled crop video. |
| `server/inpaint/requirements.txt` | Pinned worker deps. |
| `GET /api/health` | Add `inpaint: { ok, device: "cuda"\|"cpu"\|null, error? }`. |
| Watermark UI | Banner: KI bereit (CUDA/CPU) or setup hint. Process still one button. |

`delogo` helpers may remain in the repo but `POST /api/process` uses inpaint only.

## Data flow

1. Client sends `{ uploadId, box }` as today.
2. Server builds an **inpaint region**:
   - **Crop** = user box expanded by 24 px (clamped to frame, 1 px margin).
   - **Mask** (in crop coords) = original user box, filled white (inpaint), elsewhere black (keep).
   - **Feather** = 12 px at crop edges for overlay alpha (shrinks if the crop sits on the frame edge).
3. Phase A (~0–15%): FFmpeg writes a **PNG image sequence** of the crop (`crop/frame_%06d.png`, source fps) plus `mask.png`. PNGs avoid OpenCV/Windows codec issues on temp video.
4. Phase B (~15–80%): `worker.py --input-dir crop --mask mask.png --output-dir crop_fill`. Worker prints `frame i/n` to stderr; Node maps that to progress.
5. Phase C (~80–100%): FFmpeg reads `crop_fill/frame_%06d.png` at the source fps, overlays at crop `(x,y)` with feathered alpha, encodes with NVENC (`h264_nvenc` as today, `libx264` fallback), AAC audio.
6. The temp job directory (crop frames, fill frames, mask) is deleted on success, cancel, or error. Input upload is never deleted. Output is the usual job mp4 download.

### Worker rules

- Python 3.10+: try `python`, then `py -3`; override with env `INPAINT_PYTHON`.
- LaMa via pinned `simple-lama-inpainting` plus `opencv-python-headless` and `numpy`. Install CUDA `torch` first (README pin). Model files live in `server/inpaint/models/` (gitignored); first `--check` or first job downloads them if missing.
- If the crop’s long side is **> 720 px**, resize so the long side is 720, inpaint, scale back to crop size (compromise for large center overlays).
- Width/height padded to a multiple of 8 before LaMa, cropped back after.
- `--check` exits 0 and prints JSON `{ "ok": true, "device": "cuda"|"cpu" }` when imports + model path work.

## UI

- Watermark subtitle/banner: `KI bereit · CUDA` / `KI bereit · CPU (langsam)` / setup text with the pip command.
- `Remove watermark` disabled when `inpaint.ok` is false (FFmpeg-only is not enough).
- Progress bar uses the same job poll; label can stay generic (“Processing…”).
- Cancel kills whichever child is running (ffmpeg or python) and deletes temps + partial output.

## Error handling

| Situation | Behavior |
|-----------|----------|
| Python missing / import fail / model missing | Health `inpaint.ok=false`; process returns 503 with install steps (README command). |
| CUDA unavailable | `--check` reports `cpu`; jobs still run; banner notes slow path. |
| Worker crash / non-zero exit | Job `error`; no download of a partial file; temps cleaned. |
| FFmpeg crop/overlay fail | Same readable `formatFfmpegError` style as today. |
| Cancel | Kill child; clean temps and output; input intact. |
| Box on edge | Crop/mask stay in frame; feather may be smaller on the clamped side. |
| NVENC fail | Overlay encode falls back to libx264 like today’s delogo jobs. |

## Testing

No GPU required in CI.

- **Region math:** expand, clamp, even sizes, mask offset inside crop, feather shrinks on edges, 4K and 1080×1920 examples.
- **FFmpeg args:** crop filter uses `w:h:x:y`; overlay position matches crop; audio flags unchanged in spirit (AAC); NVENC vs libx264 branches.
- **Health / process:** if `--check` fails, process does not start a job.
- **Job cancel:** setting cancelled stops the tracked process (unit-test with a stub spawn if needed).
- **Python (no model):** mask/resize helpers if extracted as pure functions (pad to 8, long-side 720). Skip real LaMa inference in CI.

## Out of scope

- ProPainter / temporal video models
- Silent delogo fallback or a second quality button
- Auto-detect of watermarks
- Inpainting pixels outside the drawn box
- Cloud, accounts, batch queue
- Shipping Python/Torch inside the Node app

## Success criteria

- Corner logos and typical TikTok/YouTube marks inside the box are not readable; the patch does not look like a delogo smear in normal viewing.
- Large center overlays are improved vs delogo (soft reconstruction OK, not generative-perfect).
- 1080×1920 clip on this PC finishes in minutes, not tens of minutes, when CUDA works and the box is a corner mark.
- Audio present; output resolution matches source.
- Without the worker installed, the UI explains setup and does not produce a delogo file.

## Setup (README)

From `server/inpaint/`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python worker.py --check
```

If CUDA torch is needed, README documents the official PyTorch CUDA `pip` line before `requirements.txt`. Restart `npm run dev` after a successful `--check`.
