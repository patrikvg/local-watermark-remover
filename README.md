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

Open http://127.0.0.1:5173 — API listens on http://127.0.0.1:8787.

## Tests

```powershell
npm test
```
