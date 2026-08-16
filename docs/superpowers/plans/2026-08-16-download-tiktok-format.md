# Download TikTok Format Checkbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Download-tab checkbox that, after yt-dlp finishes, center-crops the video to 1080×1920 (9:16) with high-quality FFmpeg encoding, then saves / hands off that file (including optional Watermark).

**Architecture:** Pure `tiktokFormat.js` builds FFmpeg argv (cover+crop + quality encoder flags matching Ranking). `downloadJobs` optionally runs convert after download, replaces `outputPath` with the TikTok mp4, then registers upload. Client sends `tiktokFormat` on start and shows download/convert phases.

**Tech Stack:** Existing Fastify + React app; system FFmpeg; Vitest.

---

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/tiktokFormat.js` | Build FFmpeg args for 1080×1920 center-crop + high-quality encode |
| `server/test/tiktokFormat.test.js` | Arg builder tests |
| `server/src/downloadJobs.js` | Accept `tiktokFormat`, run convert phase, public `phase` / `tiktokFormat` |
| `server/test/downloadJobs.test.js` | Job test with mocked convert when flag on |
| `server/src/index.js` | Pass `tiktokFormat` + `preferredEncoder` into `createDownloadJob` |
| `client/src/api.ts` | `startDownload(url, { tiktokFormat })`; job status fields |
| `client/src/pages/DownloadPage.tsx` | Checkbox + phase UI |
| `README.md` | Document TikTok-format checkbox |

---

### Task 1: TikTok FFmpeg arg builder

**Files:**
- Create: `server/src/tiktokFormat.js`
- Create: `server/test/tiktokFormat.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { buildTiktokFormatArgs } from "../src/tiktokFormat.js";

describe("buildTiktokFormatArgs", () => {
  it("center-crops to 1080x1920 and uses quality nvenc settings", () => {
    const args = buildTiktokFormatArgs({
      input: "C:/in.mp4",
      output: "C:/out.mp4",
      encoder: "h264_nvenc",
    });
    expect(args).toContain("-y");
    expect(args).toContain("C:/in.mp4");
    expect(args).toContain("C:/out.mp4");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(vf).toContain("crop=1080:1920");
    expect(vf).toContain("setsar=1");
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("-cq");
    expect(args).toContain("18");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
  });

  it("uses libx264 crf quality path for software encode", () => {
    const args = buildTiktokFormatArgs({
      input: "C:/in.mp4",
      output: "C:/out.mp4",
      encoder: "libx264",
    });
    expect(args).toContain("libx264");
    expect(args).toContain("-crf");
    expect(args).toContain("17");
    expect(args).toContain("-preset");
    expect(args).toContain("medium");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test --prefix server -- test/tiktokFormat.test.js`

Expected: FAIL (module missing)

- [ ] **Step 3: Implement `tiktokFormat.js`**

```js
/**
 * Center-crop cover to TikTok / Shorts frame at high encode quality.
 * @param {{ input: string, output: string, encoder: string }} opts
 */
export function buildTiktokFormatArgs({ input, output, encoder }) {
  const vf =
    "scale=1080:1920:force_original_aspect_ratio=increase," +
    "crop=1080:1920,setsar=1";

  const args = ["-y", "-i", input, "-vf", vf];

  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    args.push(
      "-c:v",
      encoder,
      "-preset",
      "p5",
      "-rc",
      "vbr",
      "-cq",
      "18",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p"
    );
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "17",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p"
    );
  }

  args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output);
  return args;
}
```

(Matches Ranking quality-oriented NVENC/libx264 settings.)

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test --prefix server -- test/tiktokFormat.test.js`

- [ ] **Step 5: Commit**

```bash
git add server/src/tiktokFormat.js server/test/tiktokFormat.test.js
git commit -m "Add TikTok 1080x1920 FFmpeg format helper"
```

---

### Task 2: Download job convert phase

**Files:**
- Modify: `server/src/downloadJobs.js`
- Modify: `server/test/downloadJobs.test.js`

- [ ] **Step 1: Extend public job fields and createDownloadJob options**

Update `listPublicDownloadJob` to include:

```js
tiktokFormat: Boolean(job.tiktokFormat),
phase: job.phase ?? null,
```

`phase` values: `"download"` | `"convert"` | `null`.

- [ ] **Step 2: Add failing test for convert path**

Append to `server/test/downloadJobs.test.js`:

```js
  it("runs convert when tiktokFormat is true before registerUpload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-tt-"));
    const raw = path.join(dir, "raw.mp4");
    const converted = path.join(dir, "tt.mp4");
    const registerUpload = vi.fn(async ({ path: p }) => {
      expect(p).toBe(converted);
      return "upload-tt";
    });
    const runConvert = vi.fn(async (job) => {
      fs.writeFileSync(converted, "tiktok");
      job.outputPath = converted;
      job.outputName = "tt.mp4";
    });

    const job = createDownloadJob({
      url: "https://youtu.be/x",
      downloadsDir: dir,
      registerUpload,
      tiktokFormat: true,
      preferredEncoder: "libx264",
      runDownload: async (j, onProgress) => {
        fs.writeFileSync(raw, "raw");
        j.outputPath = raw;
        j.outputName = "raw.mp4";
        onProgress(1);
      },
      runConvert,
    });

    await vi.waitFor(() => {
      expect(getDownloadJob(job.id).status).toBe("done");
    });

    expect(runConvert).toHaveBeenCalled();
    expect(listPublicDownloadJob(getDownloadJob(job.id)).uploadId).toBe(
      "upload-tt"
    );
    expect(listPublicDownloadJob(getDownloadJob(job.id)).tiktokFormat).toBe(
      true
    );
  });
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `npm test --prefix server -- test/downloadJobs.test.js`

- [ ] **Step 4: Implement convert in `downloadJobs.js`**

Add imports:

```js
import { buildTiktokFormatArgs } from "./tiktokFormat.js";
```

Add `defaultRunConvert`:

```js
async function defaultRunConvert(job) {
  const input = job.outputPath;
  const outputName = `${job.id}.tiktok.mp4`;
  const outputPath = path.join(job.downloadsDir, outputName);
  const args = buildTiktokFormatArgs({
    input,
    output: outputPath,
    encoder: job.preferredEncoder || "libx264",
  });

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    job.proc = proc;
    let stderr = "";
    proc.stderr?.on("data", (buf) => {
      stderr += buf.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        // Prefer TikTok file as the job output; remove raw download to save disk.
        try {
          if (input && input !== outputPath && fs.existsSync(input)) {
            fs.unlinkSync(input);
          }
        } catch {
          /* ignore */
        }
        job.outputPath = outputPath;
        job.outputName = outputName;
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
```

Update `createDownloadJob`:

```js
export function createDownloadJob({
  url,
  downloadsDir,
  registerUpload,
  title = null,
  tiktokFormat = false,
  preferredEncoder = "libx264",
  runDownload = defaultRunDownload,
  runConvert = defaultRunConvert,
}) {
  const id = randomUUID();
  const job = {
    id,
    url,
    downloadsDir,
    title,
    tiktokFormat: Boolean(tiktokFormat),
    preferredEncoder,
    phase: null,
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
      job.phase = "download";
      await runDownload(job, (p) => {
        if (job.status === "running") {
          // Keep headroom for convert when enabled.
          job.progress = job.tiktokFormat ? Math.min(0.7, p * 0.7) : p;
        }
      });
      if (job.status === "cancelled") return;

      if (job.tiktokFormat) {
        job.phase = "convert";
        job.progress = Math.max(job.progress, 0.72);
        await runConvert(job);
        if (job.status === "cancelled") return;
        job.progress = 0.95;
      }

      job.phase = null;
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
      job.phase = null;
    }
  })();

  return job;
}
```

Existing tests that omit `tiktokFormat` must still pass (default false, no convert).

- [ ] **Step 5: Run all download job tests — PASS**

Run: `npm test --prefix server -- test/downloadJobs.test.js`

- [ ] **Step 6: Commit**

```bash
git add server/src/downloadJobs.js server/test/downloadJobs.test.js
git commit -m "Add optional TikTok convert phase to download jobs"
```

---

### Task 3: Wire API start body + encoder

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Pass flags into createDownloadJob**

In `POST /api/download/start`, read:

```js
const tiktokFormat = Boolean(request.body?.tiktokFormat);
```

Pass into create:

```js
const job = createDownloadJob({
  url: parsed.url,
  downloadsDir,
  title,
  tiktokFormat,
  preferredEncoder: cachedEncoder,
  registerUpload: registerDownloadedUpload,
});
```

When `tiktokFormat` is true, FFmpeg is already required by the existing start guard — keep that.

- [ ] **Step 2: Run full server tests**

Run: `npm test --prefix server`

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "Pass tiktokFormat and encoder into download start"
```

---

### Task 4: Client API + DownloadPage checkbox

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/pages/DownloadPage.tsx`

- [ ] **Step 1: Extend client types/helpers**

```ts
export type DownloadJobStatus = {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  error: string | null;
  outputName: string | null;
  uploadId: string | null;
  title: string | null;
  tiktokFormat?: boolean;
  phase?: "download" | "convert" | null;
};

export async function startDownload(
  url: string,
  opts?: { tiktokFormat?: boolean }
): Promise<{ jobId: string }> {
  const res = await fetch("/api/download/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      tiktokFormat: Boolean(opts?.tiktokFormat),
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
```

- [ ] **Step 2: UI on DownloadPage**

Add state:

```ts
const [tiktokFormat, setTiktokFormat] = useState(false);
```

Checkbox (German label matching product):

```tsx
<label>
  <input
    type="checkbox"
    checked={tiktokFormat}
    onChange={(e) => setTiktokFormat(e.target.checked)}
    disabled={busy}
  />
  TikTok-Format (9:16 / 1080×1920)
</label>
```

Place it near the existing **Danach Watermark entfernen** checkbox (both independent).

On start:

```ts
const { jobId: id } = await startDownload(probedUrl, { tiktokFormat });
```

While running, show phase if present, e.g.:

```tsx
{job?.phase === "convert"
  ? "Konvertiere zu TikTok-Format…"
  : job?.phase === "download"
    ? "Lade herunter…"
    : null}
```

When both checkboxes are on: existing auto-handoff to Watermark still uses `uploadId` after job `done` (server already registered the converted file).

- [ ] **Step 3: Build client**

Run: `npm run build --prefix client`

Expected: success

- [ ] **Step 4: Commit**

```bash
git add client/src/api.ts client/src/pages/DownloadPage.tsx
git commit -m "Add TikTok-format checkbox to Download tab"
```

---

### Task 5: README + verify

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document checkbox**

Under **Download**, add a bullet:

```markdown
Optional: enable **TikTok-Format (9:16 / 1080×1920)** to center-crop after download (high-quality encode). Can combine with **Danach Watermark entfernen**.
```

- [ ] **Step 2: Full server tests**

Run: `npm test --prefix server`

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document TikTok-format download option"
```

- [ ] **Step 4: Manual smoke (human)**

1. Download landscape YouTube with TikTok checkbox → file is 1080×1920, looks sharp.  
2. Both checkboxes → Watermark opens vertical video.  
3. Checkbox off → unchanged best-quality download.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Checkbox TikTok-Format | 4 |
| 1080×1920 center-crop | 1, 2 |
| High encode quality (NVENC/libx264) | 1 |
| No second original file when converting | 2 (unlink raw) |
| Both checkboxes → Watermark gets converted file | 2, 3, 4 |
| `tiktokFormat` on start API | 3, 4 |
| Phase / progress for convert | 2, 4 |
| Unit tests for args + job convert | 1, 2 |
| README | 5 |

## Out of scope (do not implement)

- Letterbox/fit mode, dual file download, output larger than 1080×1920
