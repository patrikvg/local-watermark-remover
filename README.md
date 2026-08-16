# Watermark Remover

Local web app: upload a video, draw a box over a watermark, process with FFmpeg on your machine, download the result. Nothing is uploaded to the internet.

## Requirements

- Node.js 20+
- [FFmpeg](https://ffmpeg.org/) and `ffprobe` on your PATH (already works if `ffmpeg -version` succeeds)

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

## Tests

```powershell
npm test
```
