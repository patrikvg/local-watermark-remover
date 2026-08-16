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

## Tests

```powershell
npm test
```
