# Local File TikTok Format Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **TikTok Format** nav tab where the user drops/picks a local video, converts it to 1080×1920 center-crop with the existing high-quality FFmpeg helper, downloads the result, and optionally opens Watermark with that file.

**Architecture:** Multipart upload stores the source under `server/tiktok/`; `tiktokJobs.js` runs FFmpeg via `buildTiktokFormatArgs` (same as Download checkbox); finished file registers into the existing `uploads` map for Watermark handoff. UI mirrors DownloadPage patterns without URL/yt-dlp.

**Tech Stack:** Existing Fastify + React; system FFmpeg; Vitest; reuse `tiktokFormat.js`.

---

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/paths.js` | Add `tiktokDir` + ensureDirs |
| `.gitignore` | `server/tiktok/` |
| `server/src/tiktokJobs.js` | Convert-only job store (create/get/listPublic/cancel) |
| `server/test/tiktokJobs.test.js` | Lifecycle tests with mocked runner |
| `server/src/index.js` | `/api/tiktok/*` routes + register upload |
| `client/src/api.ts` | TikTok convert API helpers |
| `client/src/pages/TikTokFormatPage.tsx` | Dropzone + checkbox + progress |
| `client/src/App.tsx` | New tab + watermark handoff |
| `client/src/styles.css` | Reuse existing dropzone/workspace classes; minimal extras only if needed |
| `README.md` | Document TikTok Format tab |

---

### Task 1: Paths + gitignore

**Files:**
- Modify: `server/src/paths.js`
- Modify: `.gitignore`

- [ ] **Step 1: Add tiktok directory**

In `paths.js`:

```js
export const tiktokDir = path.join(root, "tiktok");
```

In `ensureDirs()`:

```js
fs.mkdirSync(tiktokDir, { recursive: true });
```

In `.gitignore` add:

```
server/tiktok/
```

- [ ] **Step 2: Commit**

```bash
git add server/src/paths.js .gitignore
git commit -m "Add tiktok working directory for local converts"
```

---

### Task 2: TikTok convert job store

**Files:**
- Create: `server/src/tiktokJobs.js`
- Create: `server/test/tiktokJobs.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTiktokJob,
  getTiktokJob,
  listPublicTiktokJob,
  cancelTiktokJob,
} from "../src/tiktokJobs.js";

describe("tiktokJobs", () => {
  it("converts then exposes uploadId from registerUpload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-job-"));
    const input = path.join(dir, "in.mp4");
    const out = path.join(dir, "out.mp4");
    fs.writeFileSync(input, "raw");
    const registerUpload = vi.fn(async ({ path: p }) => {
      expect(p).toBe(out);
      return "up-1";
    });

    const job = createTiktokJob({
      inputPath: input,
      tiktokDir: dir,
      preferredEncoder: "libx264",
      registerUpload,
      runConvert: async (j) => {
        fs.writeFileSync(out, "done");
        j.outputPath = out;
        j.outputName = "out.mp4";
        j.progress = 1;
      },
    });

    expect(listPublicTiktokJob(job).status).toBe("running");

    await vi.waitFor(() => {
      expect(getTiktokJob(job.id).status).toBe("done");
    });

    const pub = listPublicTiktokJob(getTiktokJob(job.id));
    expect(pub.uploadId).toBe("up-1");
    expect(pub.progress).toBe(1);
    expect(registerUpload).toHaveBeenCalled();
  });

  it("cancel stops a running convert", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-job-"));
    const input = path.join(dir, "in.mp4");
    fs.writeFileSync(input, "raw");
    let release;
    const gate = new Promise((r) => {
      release = r;
    });

    const job = createTiktokJob({
      inputPath: input,
      tiktokDir: dir,
      preferredEncoder: "libx264",
      registerUpload: async () => "u",
      runConvert: async (j) => {
        j.proc = { kill: vi.fn() };
        await gate;
      },
    });

    cancelTiktokJob(job.id);
    release();
    await vi.waitFor(() => {
      expect(getTiktokJob(job.id).status).toBe("cancelled");
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test --prefix server -- test/tiktokJobs.test.js`

- [ ] **Step 3: Implement `tiktokJobs.js`**

```js
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildTiktokFormatArgs } from "./tiktokFormat.js";

/** @type {Map<string, object>} */
const jobs = new Map();

export function getTiktokJob(id) {
  return jobs.get(id) ?? null;
}

export function listPublicTiktokJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputName: job.outputName,
    uploadId: job.uploadId,
    filename: job.filename,
  };
}

function removeJobFiles(job) {
  for (const p of [job.inputPath, job.outputPath]) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

async function defaultRunConvert(job) {
  const outputName = `${job.id}.tiktok.mp4`;
  const outputPath = path.join(job.tiktokDir, outputName);
  const args = buildTiktokFormatArgs({
    input: job.inputPath,
    output: outputPath,
    encoder: job.preferredEncoder || "libx264",
  });

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    job.proc = proc;
    let stderr = "";
    proc.stderr?.on("data", (buf) => {
      const text = buf.toString();
      stderr += text;
      const timeMatch = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(text);
      if (timeMatch && job.duration > 0) {
        const parts = timeMatch[1].split(":");
        const t =
          Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
        if (Number.isFinite(t)) {
          job.progress = Math.min(0.95, t / job.duration);
        }
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        if (!fs.existsSync(outputPath)) {
          reject(new Error("Convert finished but output missing"));
          return;
        }
        job.outputPath = outputPath;
        job.outputName = outputName;
        job.progress = 1;
        resolve();
        return;
      }
      const msg =
        stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
        `ffmpeg exited ${code}`;
      reject(new Error(msg));
    });
  });
}

export function createTiktokJob({
  inputPath,
  tiktokDir,
  registerUpload,
  filename = null,
  duration = 0,
  preferredEncoder = "libx264",
  runConvert = defaultRunConvert,
}) {
  const id = randomUUID();
  const job = {
    id,
    inputPath,
    tiktokDir,
    filename,
    duration: duration || 0,
    preferredEncoder,
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
      await runConvert(job);
      if (job.status === "cancelled") return;
      job.uploadId = await registerUpload({
        path: job.outputPath,
        filename: job.outputName,
        title: filename ? String(filename).replace(/\.[^.]+$/, "") : null,
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

export function cancelTiktokJob(id) {
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
  removeJobFiles(job);
  return job;
}
```

- [ ] **Step 4: Tests PASS**

Run: `npm test --prefix server -- test/tiktokJobs.test.js`

- [ ] **Step 5: Commit**

```bash
git add server/src/tiktokJobs.js server/test/tiktokJobs.test.js
git commit -m "Add local TikTok convert job store"
```

---

### Task 3: Fastify `/api/tiktok` routes

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Import and wire**

Import `tiktokDir` from paths; import job helpers from `./tiktokJobs.js`.

Reuse existing `registerDownloadedUpload` (or call it with the same signature) for finished converts.

Add:

```js
app.post("/api/tiktok/upload", async (request, reply) => {
  if (!binaries.ffmpeg || !binaries.ffprobe) {
    return reply.code(503).send({
      error: "FFmpeg/ffprobe not found on PATH. Install FFmpeg and restart.",
    });
  }
  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ error: "No file uploaded" });
  }
  const id = randomUUID();
  const ext = path.extname(file.filename || "") || ".mp4";
  const storedName = `${id}${ext}`;
  const dest = path.join(tiktokDir, storedName);
  await fs.promises.writeFile(dest, await file.toBuffer());

  let meta;
  try {
    meta = await probeVideo(dest);
  } catch (err) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Could not read video",
    });
  }
  if (!meta.width || !meta.height) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({ error: "Could not detect video dimensions" });
  }

  const job = createTiktokJob({
    inputPath: dest,
    tiktokDir,
    filename: file.filename || storedName,
    duration: meta.duration,
    preferredEncoder: cachedEncoder,
    registerUpload: registerDownloadedUpload,
  });
  return {
    jobId: job.id,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    filename: file.filename || storedName,
  };
});

app.get("/api/tiktok/:id", async (request, reply) => {
  const job = getTiktokJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicTiktokJob(job);
});

app.post("/api/tiktok/:id/cancel", async (request, reply) => {
  const job = cancelTiktokJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicTiktokJob(job);
});

app.get("/api/tiktok/:id/file", async (request, reply) => {
  const job = getTiktokJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  if (job.status !== "done") {
    return reply.code(409).send({ error: "Job not finished" });
  }
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    return reply.code(404).send({ error: "Output missing" });
  }
  const name = safeDownloadFilename(
    (job.filename || "video").replace(/\.[^.]+$/, "") + "-tiktok"
  );
  reply.header("Content-Disposition", `attachment; filename="${name}"`);
  return reply.send(fs.createReadStream(job.outputPath));
});
```

Dropping a file **starts convert immediately** (upload endpoint creates the job) — UI shows progress without a second “start” call.

- [ ] **Step 2: Run full server tests**

Run: `npm test --prefix server`

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "Add local TikTok convert API routes"
```

---

### Task 4: Client API helpers

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add types and functions**

```ts
export type TiktokJobStatus = {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  error: string | null;
  outputName: string | null;
  uploadId: string | null;
  filename: string | null;
};

export async function uploadTiktokConvert(file: File): Promise<{
  jobId: string;
  width: number;
  height: number;
  duration: number;
  filename: string;
}> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/tiktok/upload", { method: "POST", body });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getTiktokJob(jobId: string): Promise<TiktokJobStatus> {
  const res = await fetch(`/api/tiktok/${jobId}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function cancelTiktokJob(
  jobId: string
): Promise<TiktokJobStatus> {
  const res = await fetch(`/api/tiktok/${jobId}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function tiktokFileUrl(jobId: string): string {
  return `/api/tiktok/${jobId}/file`;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/api.ts
git commit -m "Add client helpers for local TikTok convert"
```

---

### Task 5: TikTokFormatPage + App tab

**Files:**
- Create: `client/src/pages/TikTokFormatPage.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles.css` only if dropzone styles missing for this page (prefer reuse `.dropzone`, `.workspace`, `.check-row`, `.progress`)

- [ ] **Step 1: Implement page**

```ts
type Props = {
  onOpenWatermark: (uploadId: string) => void;
};
```

Behavior:
1. `getHealth()` — if `!ok` (ffmpeg), danger banner (yt-dlp not required).
2. Dropzone + file input (video/*) — on file: call `uploadTiktokConvert(file)`, set jobId, poll `getTiktokJob` every 500ms.
3. Checkbox **Danach Watermark entfernen** (local state).
4. On `done`: message; if checkbox + uploadId → `onOpenWatermark`; show **Datei speichern** (`tiktokFileUrl`) and **Zu Watermark**.
5. Cancel while running.
6. Show source filename + original WxH from upload response; progress percent.

German labels consistent with Download tab where applicable (Abbrechen, Datei speichern, Zu Watermark, Danach Watermark entfernen). Primary action is implicit on drop/pick (convert starts immediately).

- [ ] **Step 2: Wire App.tsx**

```tsx
type Tab = "watermark" | "ranking" | "download" | "tiktok";

// Add nav button "TikTok Format"
{tab === "tiktok" && (
  <TikTokFormatPage
    onOpenWatermark={(uploadId) => {
      setWatermarkUploadId(uploadId);
      setTab("watermark");
    }}
  />
)}
```

Reuse the same `watermarkUploadId` state already used by Download.

- [ ] **Step 3: Build**

Run: `npm run build --prefix client`

Expected: success

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TikTokFormatPage.tsx client/src/App.tsx client/src/styles.css
git commit -m "Add TikTok Format tab for local video convert"
```

---

### Task 6: README + verify

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document tab**

Add section:

```markdown
## TikTok Format

1. Open the **TikTok Format** tab.
2. Drop or choose a local video.
3. Wait for convert to **1080×1920** (center-crop, high quality).
4. Save the file, or enable **Danach Watermark entfernen** to continue in Watermark.
```

- [ ] **Step 2: Full tests**

Run: `npm test --prefix server`

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document local TikTok Format tab"
```

- [ ] **Step 4: Manual smoke (human)**

Drop a landscape mp4 → 1080×1920 output; watermark checkbox opens vertical video in Watermark.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| New TikTok Format tab | 5 |
| Local drop/pick only | 5 |
| Same 1080×1920 convert helper | 2, 3 |
| Watermark optional handoff | 3, 5 |
| Job status / cancel / file | 2, 3, 4 |
| FFmpeg required, not yt-dlp | 3, 5 |
| Unit tests mocked convert | 2 |
| README | 6 |

## Out of scope

- URL on this tab, batch, letterbox, other resolutions
