# Watermark Remover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local Vite+React + Node app that lets the user upload a video, draw a box over a static watermark, run FFmpeg delogo on that region (NVENC when available), and download a cleaned 4K-capable result — all on localhost.

**Architecture:** Browser UI talks to a localhost Fastify API. API stores uploads on disk, validates box coordinates, spawns FFmpeg with `delogo`, prefers NVIDIA encoders, streams progress/cancel, and serves the output file. Pure helper modules (`box`, `ffmpeg-args`) are unit-tested without needing a GPU in CI.

**Tech Stack:** Node 20+, Fastify, `@fastify/multipart` / `@fastify/static`, Vite, React, TypeScript (frontend), Vitest for unit tests, system FFmpeg.

---

## File map

| Path | Responsibility |
|------|----------------|
| `package.json` | Workspace scripts: `dev`, `server`, `client`, `test`, `build` |
| `server/src/box.js` | Clamp/validate/scale box coords; build delogo params |
| `server/src/ffmpegArgs.js` | Build argv for probe, delogo+encode, cancel-safe |
| `server/src/jobs.js` | In-memory job store + spawn/kill FFmpeg |
| `server/src/index.js` | Fastify routes: health, upload, process, status, download, cancel |
| `server/test/box.test.js` | Box math tests |
| `server/test/ffmpegArgs.test.js` | Arg builder tests |
| `client/index.html` | Vite entry |
| `client/src/main.tsx` | React mount |
| `client/src/App.tsx` | Page shell + flow state |
| `client/src/api.ts` | Fetch helpers to localhost API |
| `client/src/components/VideoWorkspace.tsx` | Video + scrub + overlay box + actions |
| `client/src/components/RegionBox.tsx` | Draw / move / resize rectangle |
| `client/vite.config.ts` | Dev proxy to API |
| `README.md` | How to run (FFmpeg required) |
| `.gitignore` | node_modules, uploads, outputs, dist |

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`
- Create: `server/package.json`, `client/package.json`
- Create: `client/vite.config.ts`, `client/tsconfig.json`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`

- [ ] **Step 1: Create root + ignore + README**

Root `package.json`:

```json
{
  "name": "watermark-remover",
  "private": true,
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "test": "npm test --prefix server",
    "build": "npm run build --prefix client"
  },
  "devDependencies": {
    "concurrently": "^9.1.2"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
server/uploads/
server/outputs/
*.log
.DS_Store
.superpowers/
```

`README.md`: short run instructions — install FFmpeg, `npm install` in root/server/client, `npm run dev`, open the printed URL.

- [ ] **Step 2: Scaffold server package**

`server/package.json`:

```json
{
  "name": "watermark-remover-server",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.2",
    "@fastify/multipart": "^9.0.3",
    "@fastify/static": "^8.1.1",
    "fastify": "^5.2.1"
  },
  "devDependencies": {
    "vitest": "^3.0.5"
  }
}
```

- [ ] **Step 3: Scaffold client package**

Use Vite React-TS defaults (`client/` with `App.tsx` placeholder “Watermark Remover”). Proxy `/api` → `http://127.0.0.1:8787`.

`client/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: Install deps**

Run from project root:

```powershell
npm install
npm install --prefix server
npm install --prefix client
```

Expected: installs succeed.

- [ ] **Step 5: Commit**

```powershell
git add package.json .gitignore README.md server client
git commit -m "Scaffold local watermark remover app"
```

---

### Task 2: Box coordinate helpers (TDD)

**Files:**
- Create: `server/src/box.js`
- Create: `server/test/box.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from "vitest";
import { normalizeBox, toDelogoParams } from "../src/box.js";

describe("normalizeBox", () => {
  it("clamps to frame and enforces min size", () => {
    expect(
      normalizeBox({ x: -10, y: -5, width: 2, height: 2 }, 1920, 1080)
    ).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });

  it("rejects empty video size", () => {
    expect(() => normalizeBox({ x: 0, y: 0, width: 40, height: 40 }, 0, 1080)).toThrow(
      /video size/i
    );
  });
});

describe("toDelogoParams", () => {
  it("maps box to even integers with band", () => {
    const p = toDelogoParams({ x: 101, y: 51, width: 120, height: 40 }, 8);
    expect(p).toEqual({ x: 100, y: 50, w: 120, h: 40, band: 8, show: 1 });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```powershell
npm test --prefix server
```

Expected: cannot find module `../src/box.js`

- [ ] **Step 3: Implement `server/src/box.js`**

```js
const MIN = 16;

function even(n) {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v - 1;
}

export function normalizeBox(box, videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight) throw new Error("Invalid video size");
  let x = Math.max(0, Math.min(box.x, videoWidth - 1));
  let y = Math.max(0, Math.min(box.y, videoHeight - 1));
  let width = Math.max(MIN, box.width);
  let height = Math.max(MIN, box.height);
  if (x + width > videoWidth) width = videoWidth - x;
  if (y + height > videoHeight) height = videoHeight - y;
  width = Math.max(MIN, width);
  height = Math.max(MIN, height);
  if (x + width > videoWidth) x = Math.max(0, videoWidth - width);
  if (y + height > videoHeight) y = Math.max(0, videoHeight - height);
  return {
    x: even(x),
    y: even(y),
    width: even(width),
    height: even(height),
  };
}

export function toDelogoParams(box, band = 8) {
  return {
    x: even(box.x),
    y: even(box.y),
    w: even(box.width),
    h: even(box.height),
    band: Math.max(1, Math.round(band)),
    show: 1,
  };
}

export function scaleBoxFromDisplay(box, displayWidth, displayHeight, videoWidth, videoHeight) {
  const sx = videoWidth / displayWidth;
  const sy = videoHeight / displayHeight;
  return normalizeBox(
    {
      x: box.x * sx,
      y: box.y * sy,
      width: box.width * sx,
      height: box.height * sy,
    },
    videoWidth,
    videoHeight
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```powershell
npm test --prefix server
```

- [ ] **Step 5: Commit**

```powershell
git add server/src/box.js server/test/box.test.js
git commit -m "Add box normalization helpers for delogo"
```

---

### Task 3: FFmpeg argv builder (TDD)

**Files:**
- Create: `server/src/ffmpegArgs.js`
- Create: `server/test/ffmpegArgs.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from "vitest";
import { buildDelogoArgs } from "../src/ffmpegArgs.js";

describe("buildDelogoArgs", () => {
  it("uses nvenc when requested", () => {
    const args = buildDelogoArgs({
      input: "in.mp4",
      output: "out.mp4",
      delogo: { x: 10, y: 20, w: 100, h: 40, band: 8, show: 1 },
      encoder: "h264_nvenc",
    });
    expect(args).toContain("-vf");
    expect(args.find((a) => a.startsWith("delogo="))).toMatch(/x=10:y=20:w=100:h=40/);
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("-c:a");
    expect(args).toContain("copy");
  });

  it("falls back to libx264", () => {
    const args = buildDelogoArgs({
      input: "in.mp4",
      output: "out.mp4",
      delogo: { x: 0, y: 0, w: 32, h: 32, band: 4, show: 1 },
      encoder: "libx264",
    });
    expect(args).toContain("libx264");
    expect(args).toContain("-preset");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

- [ ] **Step 3: Implement `server/src/ffmpegArgs.js`**

```js
export function buildDelogoFilter(d) {
  return `delogo=x=${d.x}:y=${d.y}:w=${d.w}:h=${d.h}:band=${d.band}:show=0`;
}

export function buildDelogoArgs({ input, output, delogo, encoder }) {
  const vf = buildDelogoFilter(delogo);
  const args = ["-y", "-i", input, "-vf", vf];

  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    args.push("-c:v", encoder, "-preset", "p4", "-rc", "vbr", "-cq", "19");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18");
  }

  args.push("-c:a", "copy", output);
  return args;
}

export function buildProbeArgs(input) {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,duration",
    "-of",
    "json",
    input,
  ];
}
```

Note: probe uses `ffprobe`, not `ffmpeg`. Job runner will call `ffprobe` with `buildProbeArgs`.

- [ ] **Step 4: Fix test expectation** — filter uses `show=0` (not preview). Update test to match `buildDelogoFilter` / args containing `delogo=...show=0`.

- [ ] **Step 5: Run tests — PASS, then commit**

```powershell
npm test --prefix server
git add server/src/ffmpegArgs.js server/test/ffmpegArgs.test.js
git commit -m "Add FFmpeg delogo argument builder"
```

---

### Task 4: Job runner + Fastify API

**Files:**
- Create: `server/src/jobs.js`
- Create: `server/src/index.js`
- Create: `server/src/paths.js`

- [ ] **Step 1: Implement paths + job store**

`server/src/paths.js` — resolve `uploads/` and `outputs/` under `server/`, `fs.mkdirSync` recursive.

`server/src/jobs.js`:

- `createJob({ inputPath, outputPath, delogo, encoder })` → `{ id, status: 'queued' }`
- `startJob(id)` spawns `ffmpeg` with args; parse `time=` from stderr for progress when duration known
- `cancelJob(id)` → `child.kill('SIGKILL')` on Windows use `taskkill` / `proc.kill()` 
- statuses: `queued | running | done | error | cancelled`
- store progress `0..1`, `error` message, paths

Encoder selection helper:

```js
export async function pickEncoder() {
  // run: ffmpeg -hide_banner -encoders
  // if stdout includes h264_nvenc → return 'h264_nvenc' else 'libx264'
}
```

- [ ] **Step 2: Implement routes in `server/src/index.js`**

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/api/health` | `{ ok: true, ffmpeg: bool, encoder }` |
| POST | `/api/upload` | multipart file → save under uploads → `{ id, filename, width, height, duration }` via ffprobe |
| POST | `/api/process` | JSON `{ uploadId, box: {x,y,width,height} }` → normalize box → start job → `{ jobId }` |
| GET | `/api/jobs/:id` | status + progress |
| POST | `/api/jobs/:id/cancel` | cancel |
| GET | `/api/jobs/:id/download` | send output file when `done` |

Listen on `127.0.0.1:8787`. Enable CORS for local Vite.

On startup, verify `ffmpeg` / `ffprobe` exist (`where ffmpeg` / spawn `-version`).

- [ ] **Step 3: Manual smoke**

```powershell
npm run dev --prefix server
curl http://127.0.0.1:8787/api/health
```

Expected: JSON with `ok: true` and encoder name.

- [ ] **Step 4: Commit**

```powershell
git add server/src
git commit -m "Add local Fastify API and FFmpeg job runner"
```

---

### Task 5: Region box UI

**Files:**
- Create: `client/src/components/RegionBox.tsx`
- Create: `client/src/components/VideoWorkspace.tsx`
- Create: `client/src/api.ts`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: `api.ts`**

Functions: `getHealth()`, `uploadVideo(file)`, `startProcess(uploadId, box)`, `getJob(jobId)`, `cancelJob(jobId)`, `downloadUrl(jobId)`.

- [ ] **Step 2: `RegionBox.tsx`**

Overlay on top of video element (absolute positioned matching displayed video content box — account for letterboxing by measuring `getBoundingClientRect` vs videoWidth/Height).

Modes:
- Drag empty area → create box
- Drag inside → move
- Corner handles → resize
- Emit `{ x, y, width, height }` in **display CSS pixels** relative to the content rect

- [ ] **Step 3: `VideoWorkspace.tsx`**

- File input / dropzone
- `<video>` with controls + range scrubber synced to `currentTime`
- RegionBox overlay
- Buttons: Remove watermark, Cancel, Download
- Poll job every 500ms while running; show percent
- On done, enable download link

Scale box with `scaleBoxFromDisplay` on server (send display size + video intrinsic size, or scale on client before POST). Prefer **scale on client** using intrinsic `video.videoWidth/Height` and displayed content size, then POST video-space coords.

- [ ] **Step 4: Wire `App.tsx`**

Load health on mount; if FFmpeg missing, show setup banner.

- [ ] **Step 5: Commit**

```powershell
git add client
git commit -m "Add video workspace with snipping-tool region box"
```

---

### Task 6: End-to-end verify + polish

**Files:**
- Modify: `README.md`, UI copy/CSS as needed

- [ ] **Step 1: Run full stack**

```powershell
npm run dev
```

Open `http://127.0.0.1:5173`.

- [ ] **Step 2: Test with a short local clip**

1. Upload sample (any mp4)
2. Draw box over a corner
3. Process — confirm job completes
4. Download and play — watermark area filled, audio present

If NVENC fails at runtime, catch FFmpeg error and automatically retry once with `libx264`.

- [ ] **Step 3: Add NVENC retry in `jobs.js` if not already present; commit**

```powershell
git add server/src/jobs.js README.md client
git commit -m "Polish runner: NVENC fallback and run docs"
```

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| Manual snipping box | Task 5 |
| Local-only processing | Task 4 |
| FFmpeg delogo + band | Tasks 2–3 |
| 4K / GPU encode preference | Tasks 3–4, 6 |
| Keep audio / resolution | Task 3 (`-c:a copy`, no scale filter) |
| Progress + cancel + errors | Tasks 4–5 |
| Auto-detect deferred | Not implemented |
| Health / missing FFmpeg | Tasks 4–5 |

## Self-review notes

- No TBD placeholders.
- `show=0` in delogo (not debug overlay).
- Client scales box to video pixels before process.
- NVENC with software fallback for reliability on first run.
