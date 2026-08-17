# Watermark Remover

Local web app: upload a video, draw a box over a watermark, and process on your machine — the Watermark tab uses local LaMa inpainting plus FFmpeg. Download the result; nothing is uploaded to the internet.

## Requirements

- Node.js 20+
- [FFmpeg](https://ffmpeg.org/) and `ffprobe` on your PATH (already works if `ffmpeg -version` succeeds)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your PATH (`yt-dlp --version`)
- Python 3.10+ (3.11 or 3.12 recommended for the LaMa worker)

## Inpaint engine (Watermark tab)

delogo is no longer used. The Watermark tab needs a local LaMa worker:

```powershell
cd server/inpaint
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install --no-deps simple-lama-inpainting==0.1.2
pip install -r requirements.txt
python worker.py --check
```

`--no-deps` is required: the 0.1.2 package pins Pillow 9 / NumPy 1, which do not build on Python 3.13. Torch already provides current Pillow and NumPy.

`--check` should print `"device": "cuda"` on the RTX 5070 Ti. If it says `cpu`, the CUDA torch wheel did not install — fix that before processing long clips.

Restart `npm run dev` after a successful check. The first **Remove watermark** run downloads `big-lama.pt` into `server/inpaint/models/` (~200 MB, once).

## Setup

```powershell
npm install
npm install --prefix server
npm install --prefix client
```

## Run

```powershell
npm run dev
```

Open http://127.0.0.1:5173 (or http://localhost:5173). API listens on http://127.0.0.1:8787.

If you see `EADDRINUSE`, an old `npm run dev` is still running — stop it with Ctrl+C, or close that terminal, then start again.

## Ranking

Build a vertical Top-5 Short from five clips:

1. Run `npm run dev` and open the **Ranking** tab.
2. Upload 5 clips, then reorder them (first slot = rank **#5**, last slot = rank **#1**).
3. Drag the title on the preview; choose audio (clip audio + optional BGM, or mute clips + BGM).
4. Export at **9:16** / **1080×1920**.

The **Watermark** tab remains a separate flow for box-based watermark removal.

## TikTok Format

1. Open the **TikTok Format** tab.
2. Drop or choose a local video.
3. Wait for convert to **1080×1920** (center-crop, high quality).
4. Save the file, or enable **Danach Watermark entfernen** to continue in Watermark.

## Download

1. Open the **Download** tab.
2. Paste a YouTube or TikTok URL → **Prüfen** to see the best available resolution.
3. **Herunterladen** (optional: **Danach Watermark entfernen**).
   - Optional: enable **TikTok-Format (9:16 / 1080×1920)** to center-crop after download (high-quality encode). Can combine with **Danach Watermark entfernen**.
4. Save the file, or continue in Watermark and draw the box as usual.

## Tests

```powershell
npm test
```
