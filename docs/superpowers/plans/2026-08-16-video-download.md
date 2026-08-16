# Video Download (YouTube / TikTok) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Download tab that probes a YouTube/TikTok URL with yt-dlp, shows the best available resolution, downloads at that best quality, and optionally opens the Watermark tab with the file already loaded.

**Architecture:** Pure helpers validate URLs and parse yt-dlp JSON; Fastify spawns yt-dlp for probe/download (same job pattern as FFmpeg); finished files register into the existing in-memory `uploads` map plus a media route so Watermark can preview without a second file pick. Watermark checkbox stays client-only.

**Tech Stack:** Existing Vite/React + Fastify app; system `yt-dlp` + FFmpeg; Vitest for unit tests (mocked yt-dlp, no network).

---

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/downloadUrl.js` | Allowlist YouTube/TikTok URLs; detect platform |
| `server/src/ytdlp.js` | Binary check; build probe/download argv; parse JSON metadata + progress; injectable `run` for tests |
| `server/src/downloadJobs.js` | In-memory download jobs: start, progress, cancel, public view |
| `server/src/paths.js` | Add `downloadsDir` + ensure it exists |
| `server/src/index.js` | Health `ytdlp`; probe/start/status/cancel/file routes; register upload + media stream |
| `server/test/downloadUrl.test.js` | URL allowlist tests |
| `server/test/ytdlp.test.js` | Parse/format/arg tests with fixtures |
| `server/test/downloadJobs.test.js` | Job lifecycle with mocked runner |
| `client/src/api.ts` | Health + download API types/helpers; upload media URL |
| `client/src/pages/DownloadPage.tsx` | URL → probe → download UI |
| `client/src/App.tsx` | Download tab; handoff state to Watermark |
| `client/src/pages/WatermarkPage.tsx` | Accept optional `initialUploadId` |
| `client/src/components/VideoWorkspace.tsx` | Load upload from server media URL when handed off |
| `client/src/styles.css` | Minimal Download-tab styles matching existing banners/workspace |
| `README.md` | Document yt-dlp requirement |
| `.gitignore` | `server/downloads/` |

---

### Task 1: URL allowlist helper

**Files:**
- Create: `server/src/downloadUrl.js`
- Create: `server/test/downloadUrl.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { parseDownloadUrl } from "../src/downloadUrl.js";

describe("parseDownloadUrl", () => {
  it("accepts youtube watch and youtu.be", () => {
    expect(parseDownloadUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      ok: true,
      platform: "youtube",
    });
    expect(parseDownloadUrl("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      ok: true,
      platform: "youtube",
    });
  });

  it("accepts tiktok URLs", () => {
    expect(
      parseDownloadUrl("https://www.tiktok.com/@user/video/1234567890123456789")
    ).toMatchObject({ ok: true, platform: "tiktok" });
    expect(parseDownloadUrl("https://vm.tiktok.com/ZMabcdef/")).toMatchObject({
      ok: true,
      platform: "tiktok",
    });
  });

  it("rejects other hosts and empty input", () => {
    expect(parseDownloadUrl("https://instagram.com/reel/abc").ok).toBe(false);
    expect(parseDownloadUrl("not-a-url").ok).toBe(false);
    expect(parseDownloadUrl("").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix server -- test/downloadUrl.test.js`

Expected: FAIL (module / export missing)

- [ ] **Step 3: Implement `downloadUrl.js`**

```js
/**
 * @param {string} raw
 * @returns {{ ok: true, url: string, platform: "youtube" | "tiktok" } | { ok: false, error: string }}
 */
export function parseDownloadUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "URL is required" };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Invalid URL" };
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  const youtubeHosts = new Set([
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);
  if (youtubeHosts.has(host) || host.endsWith(".youtube.com")) {
    return { ok: true, url: parsed.toString(), platform: "youtube" };
  }

  const tiktokHosts = new Set(["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]);
  if (tiktokHosts.has(host) || host.endsWith(".tiktok.com")) {
    return { ok: true, url: parsed.toString(), platform: "tiktok" };
  }

  return {
    ok: false,
    error: "Only YouTube and TikTok URLs are supported",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix server -- test/downloadUrl.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/downloadUrl.js server/test/downloadUrl.test.js
git commit -m "Add YouTube/TikTok URL allowlist helper"
```

---

### Task 2: yt-dlp parse + argv helpers

**Files:**
- Create: `server/src/ytdlp.js`
- Create: `server/test/ytdlp.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import {
  buildProbeArgs,
  buildDownloadArgs,
  pickBestResolution,
  labelResolution,
  parseProgressLine,
  summarizeProbe,
} from "../src/ytdlp.js";

const fixture = {
  title: "Demo Clip",
  duration: 42.5,
  formats: [
    { height: 720, width: 1280, vcodec: "avc1", acodec: "none" },
    { height: 2160, width: 3840, vcodec: "vp9", acodec: "none" },
    { height: null, width: null, vcodec: "none", acodec: "mp4a" },
    { height: 1080, width: 1920, vcodec: "avc1", acodec: "mp4a" },
  ],
};

describe("ytdlp helpers", () => {
  it("builds probe and download argv", () => {
    expect(buildProbeArgs("https://youtu.be/x")).toEqual([
      "-J",
      "--no-playlist",
      "https://youtu.be/x",
    ]);
    const dl = buildDownloadArgs({
      url: "https://youtu.be/x",
      outputTemplate: "C:/tmp/out.%(ext)s",
    });
    expect(dl).toContain("-f");
    expect(dl).toContain("bv*+ba/b");
    expect(dl).toContain("--merge-output-format");
    expect(dl).toContain("mp4");
    expect(dl).toContain("--newline");
    expect(dl.at(-1)).toBe("https://youtu.be/x");
  });

  it("picks best video resolution and labels it", () => {
    expect(pickBestResolution(fixture.formats)).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(labelResolution(3840, 2160)).toBe("3840×2160 (4K)");
    expect(labelResolution(1920, 1080)).toBe("1920×1080 (Full HD)");
    expect(labelResolution(1280, 720)).toBe("1280×720 (HD)");
    expect(labelResolution(640, 360)).toBe("640×360");
  });

  it("summarizes probe JSON", () => {
    expect(summarizeProbe(fixture, "youtube")).toEqual({
      title: "Demo Clip",
      duration: 42.5,
      width: 3840,
      height: 2160,
      resolutionLabel: "3840×2160 (4K)",
      platform: "youtube",
    });
  });

  it("parses download progress percent", () => {
    expect(parseProgressLine("[download]  45.2% of 10.00MiB")).toBeCloseTo(0.452);
    expect(parseProgressLine("[download] 100% of 10.00MiB")).toBe(1);
    expect(parseProgressLine("merging formats")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix server -- test/ytdlp.test.js`

Expected: FAIL

- [ ] **Step 3: Implement helpers in `ytdlp.js`**

```js
import { spawn } from "node:child_process";

export function buildProbeArgs(url) {
  return ["-J", "--no-playlist", url];
}

export function buildDownloadArgs({ url, outputTemplate }) {
  return [
    "-f",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--newline",
    "-o",
    outputTemplate,
    url,
  ];
}

export function pickBestResolution(formats) {
  let best = { width: 0, height: 0 };
  for (const f of formats ?? []) {
    const vcodec = f?.vcodec;
    if (!vcodec || vcodec === "none") continue;
    const height = Number(f.height) || 0;
    const width = Number(f.width) || 0;
    if (height > best.height || (height === best.height && width > best.width)) {
      best = { width, height };
    }
  }
  return best;
}

export function labelResolution(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const base = `${w}×${h}`;
  if (h >= 2160 || w >= 3840) return `${base} (4K)`;
  if (h >= 1080 || w >= 1920) return `${base} (Full HD)`;
  if (h >= 720 || w >= 1280) return `${base} (HD)`;
  return base;
}

export function summarizeProbe(json, platform) {
  const { width, height } = pickBestResolution(json?.formats);
  return {
    title: String(json?.title || "Untitled"),
    duration: Number(json?.duration) || 0,
    width,
    height,
    resolutionLabel: labelResolution(width, height),
    platform,
  };
}

export function parseProgressLine(line) {
  const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(String(line));
  if (!m) return null;
  return Math.min(1, Number(m[1]) / 100);
}

/** @returns {Promise<boolean>} */
export function checkYtdlp(spawnFn = spawn) {
  return new Promise((resolve) => {
    const proc = spawnFn("yt-dlp", ["--version"], { windowsHide: true });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Run yt-dlp and collect stdout text. Rejects on non-zero exit.
 * @param {string[]} args
 * @param {{ spawnFn?: typeof spawn, onStderr?: (s: string) => void }} [opts]
 */
export function runYtdlp(args, opts = {}) {
  const spawnFn = opts.spawnFn ?? spawn;
  return new Promise((resolve, reject) => {
    const proc = spawnFn("yt-dlp", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      opts.onStderr?.(text);
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const msg =
          stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
          `yt-dlp exited ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

export async function probeUrl(url, platform, opts = {}) {
  const { stdout } = await runYtdlp(buildProbeArgs(url), opts);
  const json = JSON.parse(stdout);
  return summarizeProbe(json, platform);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix server -- test/ytdlp.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ytdlp.js server/test/ytdlp.test.js
git commit -m "Add yt-dlp probe/download helpers"
```

---

### Task 3: Download job store

**Files:**
- Create: `server/src/downloadJobs.js`
- Create: `server/test/downloadJobs.test.js`
- Modify: `server/src/paths.js`
- Modify: `.gitignore`

- [ ] **Step 1: Extend paths + gitignore**

In `server/src/paths.js`, add:

```js
export const downloadsDir = path.join(root, "downloads");
```

In `ensureDirs()`, also `fs.mkdirSync(downloadsDir, { recursive: true });`

In `.gitignore`, add `server/downloads/`.

- [ ] **Step 2: Write failing job tests**

```js
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDownloadJob,
  getDownloadJob,
  listPublicDownloadJob,
  cancelDownloadJob,
} from "../src/downloadJobs.js";

describe("downloadJobs", () => {
  it("runs to done and exposes uploadId from registerUpload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-job-"));
    const outFile = path.join(dir, "clip.mp4");
    const registerUpload = vi.fn(async () => "upload-1");

    const job = createDownloadJob({
      url: "https://youtu.be/x",
      downloadsDir: dir,
      registerUpload,
      runDownload: async (j, onProgress) => {
        onProgress(0.5);
        fs.writeFileSync(outFile, "fake");
        j.outputPath = outFile;
        j.outputName = "clip.mp4";
        onProgress(1);
      },
    });

    expect(listPublicDownloadJob(job).status).toBe("running");

    await vi.waitFor(() => {
      expect(getDownloadJob(job.id).status).toBe("done");
    });

    const pub = listPublicDownloadJob(getDownloadJob(job.id));
    expect(pub.progress).toBe(1);
    expect(pub.uploadId).toBe("upload-1");
    expect(registerUpload).toHaveBeenCalled();
  });

  it("cancel stops a running job", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-job-"));
    let release;
    const gate = new Promise((r) => {
      release = r;
    });

    const job = createDownloadJob({
      url: "https://youtu.be/x",
      downloadsDir: dir,
      registerUpload: async () => "u",
      runDownload: async (j) => {
        j.proc = { kill: vi.fn() };
        await gate;
      },
    });

    cancelDownloadJob(job.id);
    release();
    await vi.waitFor(() => {
      expect(getDownloadJob(job.id).status).toBe("cancelled");
    });
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npm test --prefix server -- test/downloadJobs.test.js`

- [ ] **Step 4: Implement `downloadJobs.js`**

```js
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildDownloadArgs, parseProgressLine } from "./ytdlp.js";

/** @type {Map<string, object>} */
const jobs = new Map();

export function getDownloadJob(id) {
  return jobs.get(id) ?? null;
}

export function listPublicDownloadJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputName: job.outputName,
    uploadId: job.uploadId,
    title: job.title,
  };
}

async function defaultRunDownload(job, onProgress) {
  const template = path.join(job.downloadsDir, `${job.id}.%(ext)s`);
  const args = buildDownloadArgs({ url: job.url, outputTemplate: template });

  await new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { windowsHide: true });
    job.proc = proc;
    let stderr = "";

    const onChunk = (buf) => {
      const text = buf.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        const p = parseProgressLine(line);
        if (p != null) onProgress(Math.min(0.95, p));
      }
    };
    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);
    proc.on("error", reject);
    proc.on("close", (code) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        const mp4 = path.join(job.downloadsDir, `${job.id}.mp4`);
        if (!fs.existsSync(mp4)) {
          reject(new Error("Download finished but output file missing"));
          return;
        }
        job.outputPath = mp4;
        job.outputName = `${job.id}.mp4`;
        onProgress(1);
        resolve();
        return;
      }
      const msg =
        stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
        `yt-dlp exited ${code}`;
      reject(new Error(msg));
    });
  });
}

export function createDownloadJob({
  url,
  downloadsDir,
  registerUpload,
  title = null,
  runDownload = defaultRunDownload,
}) {
  const id = randomUUID();
  const job = {
    id,
    url,
    downloadsDir,
    title,
    status: "queued",
    progress: 0,
    error: null,
    outputPath: null,
    outputName: null,
    uploadId: null,
    proc: null,
  };
  jobs.set(id, job);

  (async () => {
    job.status = "running";
    try {
      await runDownload(job, (p) => {
        if (job.status === "running") job.progress = p;
      });
      if (job.status === "cancelled") return;
      job.uploadId = await registerUpload({
        path: job.outputPath,
        filename: job.outputName,
        title: job.title,
      });
      if (job.status !== "cancelled") {
        job.status = "done";
        job.progress = 1;
      }
    } catch (err) {
      if (job.status === "cancelled") return;
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    }
  })();

  return job;
}

export function cancelDownloadJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === "done" || job.status === "error") return job;
  job.status = "cancelled";
  job.error = "Cancelled";
  if (job.proc) {
    try {
      job.proc.kill();
    } catch {
      /* ignore */
    }
  }
  if (job.outputPath && fs.existsSync(job.outputPath)) {
    try {
      fs.unlinkSync(job.outputPath);
    } catch {
      /* ignore */
    }
  }
  return job;
}
```

- [ ] **Step 5: Run job tests — expect PASS**

Run: `npm test --prefix server -- test/downloadJobs.test.js`

- [ ] **Step 6: Commit**

```bash
git add server/src/paths.js server/src/downloadJobs.js server/test/downloadJobs.test.js .gitignore
git commit -m "Add download job store and downloads directory"
```

---

### Task 4: Fastify download + upload media routes

**Files:**
- Modify: `server/src/index.js`

Prefer **not** changing `checkBinaries` for FFmpeg callers: in `index.js` `refreshEnv`, also set `ytdlp` via `checkYtdlp` from `./ytdlp.js`.

- [ ] **Step 1: Wire health**

```js
app.get("/api/health", async () => ({
  ok: binaries.ffmpeg && binaries.ffprobe,
  ffmpeg: binaries.ffmpeg,
  ffprobe: binaries.ffprobe,
  ytdlp: Boolean(binaries.ytdlp),
  encoder: cachedEncoder,
}));
```

Initialize `binaries = { ffmpeg: false, ffprobe: false, ytdlp: false }` and set `ytdlp` in `refreshEnv` via `checkYtdlp`.

- [ ] **Step 2: Add `registerDownloadedUpload` helper inside `index.js`**

```js
async function registerDownloadedUpload({ path: filePath, filename, title }) {
  const id = randomUUID();
  let meta;
  try {
    meta = await probeVideo(filePath);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Could not read downloaded video"
    );
  }
  if (!meta.width || !meta.height) {
    throw new Error("Could not detect video dimensions");
  }
  uploads.set(id, {
    id,
    path: filePath,
    filename: title ? `${title}.mp4` : filename,
    ...meta,
  });
  return id;
}
```

- [ ] **Step 3: Add routes**

At top of `index.js`, import:

```js
import { parseDownloadUrl } from "./downloadUrl.js";
import { checkYtdlp, probeUrl } from "./ytdlp.js";
import {
  cancelDownloadJob,
  createDownloadJob,
  getDownloadJob,
  listPublicDownloadJob,
} from "./downloadJobs.js";
import { downloadsDir } from "./paths.js";
```

(Merge `downloadsDir` into the existing `./paths.js` import.)

Add these handlers:

```js
app.post("/api/download/probe", async (request, reply) => {
  if (!binaries.ytdlp) {
    return reply.code(503).send({
      error: "yt-dlp not found on PATH. Install yt-dlp and restart.",
    });
  }
  const parsed = parseDownloadUrl(request.body?.url);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  try {
    return await probeUrl(parsed.url, parsed.platform);
  } catch (err) {
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Probe failed",
    });
  }
});

app.post("/api/download/start", async (request, reply) => {
  if (!binaries.ytdlp) {
    return reply.code(503).send({
      error: "yt-dlp not found on PATH. Install yt-dlp and restart.",
    });
  }
  if (!binaries.ffmpeg) {
    return reply.code(503).send({
      error: "FFmpeg not found on PATH (required to merge best video+audio).",
    });
  }
  const parsed = parseDownloadUrl(request.body?.url);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

  let title = null;
  try {
    const info = await probeUrl(parsed.url, parsed.platform);
    title = info.title;
  } catch {
    /* title optional */
  }

  const job = createDownloadJob({
    url: parsed.url,
    downloadsDir,
    title,
    registerUpload: registerDownloadedUpload,
  });
  return { jobId: job.id };
});

app.get("/api/download/:id", async (request, reply) => {
  const job = getDownloadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicDownloadJob(job);
});

app.post("/api/download/:id/cancel", async (request, reply) => {
  const job = cancelDownloadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicDownloadJob(job);
});

app.get("/api/download/:id/file", async (request, reply) => {
  const job = getDownloadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  if (job.status !== "done") {
    return reply.code(409).send({ error: "Job not finished" });
  }
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    return reply.code(404).send({ error: "Output missing" });
  }
  const safe = String(job.title || job.outputName || "video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .slice(0, 80);
  const name = safe.toLowerCase().endsWith(".mp4") ? safe : `${safe}.mp4`;
  reply.header("Content-Disposition", `attachment; filename="${name}"`);
  return reply.send(fs.createReadStream(job.outputPath));
});

app.get("/api/uploads/:id", async (request, reply) => {
  const upload = uploads.get(request.params.id);
  if (!upload) return reply.code(404).send({ error: "Upload not found" });
  return {
    id: upload.id,
    filename: upload.filename,
    width: upload.width,
    height: upload.height,
    duration: upload.duration,
  };
});

app.get("/api/uploads/:id/media", async (request, reply) => {
  const upload = uploads.get(request.params.id);
  if (!upload) return reply.code(404).send({ error: "Upload not found" });
  if (!fs.existsSync(upload.path)) {
    return reply.code(404).send({ error: "File missing" });
  }
  return reply.send(fs.createReadStream(upload.path));
});
```

- [ ] **Step 4: Smoke-check**

Run: `npm test --prefix server` — existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js
git commit -m "Add download and upload media API routes"
```

---

### Task 5: Client API helpers

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Extend types and functions**

Add optional `ytdlp?: boolean` on `Health`.

Add types `DownloadProbe` and `DownloadJobStatus`.

Add functions:

- `probeDownload(url)`
- `startDownload(url)`
- `getDownloadJob(jobId)`
- `cancelDownloadJob(jobId)`
- `downloadFileUrl(jobId)` → `/api/download/${jobId}/file`
- `getUpload(id)`
- `uploadMediaUrl(id)` → `/api/uploads/${id}/media`

Use the same `readError` helper as existing fetch wrappers.

- [ ] **Step 2: Commit**

```bash
git add client/src/api.ts
git commit -m "Add client helpers for download and upload media"
```

---

### Task 6: Download page + tab wiring

**Files:**
- Create: `client/src/pages/DownloadPage.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles.css` (only if needed)

- [ ] **Step 1: Implement `DownloadPage`**

```ts
type Props = {
  onOpenWatermark: (uploadId: string) => void;
};
```

Behavior:
1. Health check; if `ytdlp === false`, danger banner to install yt-dlp.
2. URL input + **Prüfen** → `probeDownload` → show title / duration / `resolutionLabel` / platform.
3. Checkbox **Danach Watermark entfernen** (local state only).
4. **Herunterladen** → `startDownload` → poll `getDownloadJob` every 500ms.
5. On `done`: **Datei speichern** link via `downloadFileUrl`; if checkbox on call `onOpenWatermark(uploadId)`; always offer **Zu Watermark** when `uploadId` is set.
6. Cancel while running.

- [ ] **Step 2: Wire `App.tsx`**

```tsx
type Tab = "watermark" | "ranking" | "download";

const [tab, setTab] = useState<Tab>("watermark");
const [watermarkUploadId, setWatermarkUploadId] = useState<string | null>(null);

// Add Download nav button.
// watermark → <WatermarkPage initialUploadId={watermarkUploadId} />
// download → <DownloadPage onOpenWatermark={(id) => { setWatermarkUploadId(id); setTab("watermark"); }} />
```

- [ ] **Step 3: Build check**

Run: `npm run build --prefix client`

Expected: success (fix any TS errors)

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/DownloadPage.tsx client/src/App.tsx client/src/styles.css
git commit -m "Add Download tab UI for YouTube and TikTok"
```

---

### Task 7: Watermark handoff into VideoWorkspace

**Files:**
- Modify: `client/src/pages/WatermarkPage.tsx`
- Modify: `client/src/components/VideoWorkspace.tsx`

- [ ] **Step 1: Pass `initialUploadId` through WatermarkPage**

```tsx
type Props = { initialUploadId?: string | null };

export default function WatermarkPage({ initialUploadId = null }: Props) {
  // existing health UI...
  {health?.ok && (
    <VideoWorkspace ready={ready} initialUploadId={initialUploadId} />
  )}
}
```

- [ ] **Step 2: Load server media in VideoWorkspace**

Extend props with `initialUploadId?: string | null`.

When `initialUploadId` and `ready` are set, `getUpload` then set:

- `fileUrl` to `uploadMediaUrl(id)` (not a blob)
- `upload` to the metadata result

Only revoke `blob:` URLs in cleanup (never revoke `/api/uploads/.../media`).

Message: `Loaded W×H. Draw a box over the watermark.`

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/WatermarkPage.tsx client/src/components/VideoWorkspace.tsx
git commit -m "Load downloaded uploads into Watermark workspace"
```

---

### Task 8: README + full test pass

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document yt-dlp**

Requirements: add yt-dlp on PATH (`yt-dlp --version`).

Add **Download** section: Prüfen → best resolution → Herunterladen → optional Watermark checkbox.

- [ ] **Step 2: Run full server tests**

Run: `npm test --prefix server`

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document yt-dlp Download tab usage"
```

- [ ] **Step 4: Manual smoke (human)**

With `npm run dev` and yt-dlp installed: one YouTube + one TikTok download; checkbox path into Watermark box drawing.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Download tab + URL probe with best resolution shown | 2, 4, 6 |
| Always best quality (`bv*+ba/b` → mp4 merge) | 2, 3 |
| YouTube + TikTok only | 1, 4 |
| yt-dlp on PATH / health flag | 2, 4, 6, 8 |
| Progress + cancel | 3, 4, 6 |
| File download endpoint | 4, 6 |
| Optional → Watermark with upload loaded | 4, 6, 7 |
| Watermark checkbox client-only | 6 |
| Unit tests mocked / no network CI downloads | 1–3 |
| README | 8 |

## Out of scope (do not implement)

- Quality dropdown, playlists, Instagram, auto watermark region, subtitles, audio-only
