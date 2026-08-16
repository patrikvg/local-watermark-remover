# Ranking Shorts Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Ranking module to the existing local app so the user can upload 5 clips, reorder ranks 5→1, place a title, choose audio, preview in 9:16, and export one Short with stacked left-flying rank numbers via FFmpeg.

**Architecture:** Keep Watermark on its own route/page. Add Ranking UI + API routes that upload clips/BGM, compute segment timelines, and run an FFmpeg job (scale/crop to 1080×1920, concat, drawtext overlays for ranks/title, audio mix). Reuse existing health/encoder/job patterns from `server/src/jobs.js`.

**Tech Stack:** Existing Vite + React client, Fastify server, Vitest, system FFmpeg (NVENC preferred).

**Spec:** `docs/superpowers/specs/2026-08-16-ranking-shorts-design.md`

---

## File map

| Path | Responsibility |
|------|----------------|
| `client/src/App.tsx` | Top nav: Watermark \| Ranking; route-like tab state |
| `client/src/pages/WatermarkPage.tsx` | Current watermark UI moved here |
| `client/src/pages/RankingPage.tsx` | Ranking editor page shell |
| `client/src/components/ranking/ClipSlots.tsx` | Upload 5 clips + drag reorder |
| `client/src/components/ranking/TitleOverlay.tsx` | Draggable title on 9:16 stage |
| `client/src/components/ranking/RankingPreview.tsx` | Preview playback + stacked numbers |
| `client/src/components/ranking/AudioControls.tsx` | Mute clips / BGM upload / level |
| `client/src/api.ts` | Add ranking upload/export helpers |
| `server/src/rankingTimeline.js` | Segment starts, rank order, drawtext timing |
| `server/src/rankingFfmpeg.js` | Build FFmpeg argv/filter_complex for export |
| `server/src/rankingJobs.js` | Create/run/cancel ranking export jobs |
| `server/src/paths.js` | Add `rankingUploadsDir` / ensure dirs |
| `server/src/index.js` | Ranking HTTP routes |
| `server/test/rankingTimeline.test.js` | Timeline unit tests |
| `server/test/rankingFfmpeg.test.js` | Filter/argv unit tests |
| `README.md` | Document Ranking module |

**Output canvas (fixed v1):** `1080×1920` (9:16).  
**Rank order:** UI list top→bottom is export order: first item = rank **5**, last = rank **1**.

---

### Task 1: Split App into Watermark page + nav

**Files:**
- Create: `client/src/pages/WatermarkPage.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles.css` (nav styles)

- [ ] **Step 1: Move current watermark UI into `WatermarkPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getHealth, type Health } from "../api";
import VideoWorkspace from "../components/VideoWorkspace";

export default function WatermarkPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  const ready = Boolean(health?.ok);

  return (
    <>
      <header className="hero">
        <h1>Watermark Remover</h1>
        <p className="subtitle">
          Draw a box over the mark. Processing stays on your PC
          {health?.encoder ? ` · encoder ${health.encoder}` : ""}.
        </p>
      </header>
      {error && (
        <div className="banner danger">
          Cannot reach local API. Start with <code>npm run dev</code>. ({error})
        </div>
      )}
      {health && !health.ok && (
        <div className="banner danger">
          FFmpeg/ffprobe not found on PATH.
        </div>
      )}
      {health?.ok && <div className="banner ok">Local engine ready.</div>}
      <VideoWorkspace ready={ready} />
    </>
  );
}
```

- [ ] **Step 2: Update `App.tsx` with tab nav**

```tsx
import { useState } from "react";
import WatermarkPage from "./pages/WatermarkPage";
import RankingPage from "./pages/RankingPage";

type Tab = "watermark" | "ranking";

export default function App() {
  const [tab, setTab] = useState<Tab>("watermark");
  return (
    <main className="app">
      <nav className="top-nav">
        <button
          type="button"
          className={tab === "watermark" ? "active" : ""}
          onClick={() => setTab("watermark")}
        >
          Watermark
        </button>
        <button
          type="button"
          className={tab === "ranking" ? "active" : ""}
          onClick={() => setTab("ranking")}
        >
          Ranking
        </button>
      </nav>
      {tab === "watermark" ? <WatermarkPage /> : <RankingPage />}
    </main>
  );
}
```

- [ ] **Step 3: Add stub `RankingPage.tsx`**

```tsx
export default function RankingPage() {
  return (
    <header className="hero">
      <h1>Ranking Shorts</h1>
      <p className="subtitle">Top 5 clips → one 9:16 Short. Coming next.</p>
    </header>
  );
}
```

- [ ] **Step 4: Add `.top-nav` styles; run client build**

```powershell
npm run build --prefix client
```

Expected: success.

- [ ] **Step 5: Commit**

```powershell
git add client/src/App.tsx client/src/pages client/src/styles.css
git commit -m "Split Watermark page and add Ranking nav tab"
```

---

### Task 2: Ranking timeline helpers (TDD)

**Files:**
- Create: `server/src/rankingTimeline.js`
- Create: `server/test/rankingTimeline.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from "vitest";
import {
  buildSegments,
  rankForIndex,
  stackPositions,
} from "../src/rankingTimeline.js";

describe("rankForIndex", () => {
  it("maps 0..4 to ranks 5..1", () => {
    expect([0, 1, 2, 3, 4].map(rankForIndex)).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("buildSegments", () => {
  it("computes start times from durations", () => {
    const segs = buildSegments([2, 3, 1, 4, 2]);
    expect(segs).toEqual([
      { index: 0, rank: 5, start: 0, duration: 2 },
      { index: 1, rank: 4, start: 2, duration: 3 },
      { index: 2, rank: 3, start: 5, duration: 1 },
      { index: 3, rank: 2, start: 6, duration: 4 },
      { index: 4, rank: 1, start: 10, duration: 2 },
    ]);
    expect(segs.reduce((s, x) => s + x.duration, 0)).toBe(12);
  });

  it("rejects wrong clip count", () => {
    expect(() => buildSegments([1, 2, 3])).toThrow(/exactly 5/i);
  });
});

describe("stackPositions", () => {
  it("stacks ranks top-to-bottom for 5 then 4", () => {
    const pos = stackPositions({
      canvasWidth: 1080,
      canvasHeight: 1920,
      leftPad: 48,
      topPad: 220,
      lineHeight: 140,
      fontSize: 120,
    });
    expect(pos[5].x).toBe(48);
    expect(pos[5].y).toBe(220);
    expect(pos[4].y).toBe(360);
    expect(pos[1].y).toBe(220 + 140 * 4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
npm test --prefix server
```

- [ ] **Step 3: Implement `server/src/rankingTimeline.js`**

```js
export function rankForIndex(index) {
  return 5 - index;
}

export function buildSegments(durations) {
  if (!Array.isArray(durations) || durations.length !== 5) {
    throw new Error("Exactly 5 clip durations required");
  }
  let start = 0;
  return durations.map((duration, index) => {
    const d = Number(duration);
    if (!Number.isFinite(d) || d <= 0) {
      throw new Error(`Invalid duration at index ${index}`);
    }
    const seg = { index, rank: rankForIndex(index), start, duration: d };
    start += d;
    return seg;
  });
}

export function stackPositions({
  leftPad = 48,
  topPad = 220,
  lineHeight = 140,
  fontSize = 120,
}) {
  /** @type {Record<number, {x:number,y:number,fontSize:number}>} */
  const out = {};
  for (let rank = 5; rank >= 1; rank--) {
    const stackIndex = 5 - rank; // 5 -> 0, 1 -> 4
    out[rank] = {
      x: leftPad,
      y: topPad + stackIndex * lineHeight,
      fontSize,
    };
  }
  return out;
}

export const ANIM_SECONDS = 0.45;
export const CANVAS = { width: 1080, height: 1920 };
```

- [ ] **Step 4: Run tests — PASS, commit**

```powershell
npm test --prefix server
git add server/src/rankingTimeline.js server/test/rankingTimeline.test.js
git commit -m "Add ranking timeline helpers"
```

---

### Task 3: FFmpeg ranking filter builder (TDD)

**Files:**
- Create: `server/src/rankingFfmpeg.js`
- Create: `server/test/rankingFfmpeg.test.js`

**Approach:** For each input clip `i`:
1. `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p` → `[vI]`
2. Audio: either keep as `[aI]` or `anullsrc` / silence if muted.
3. `concat=n=5:v=1:a=1` → `[vout][aout]`
4. Stacked `drawtext` filters chained on `[vout]`:
   - Each rank `R` appears at segment start `T`:
   - `x='if(lt(t-T,ANIM), -tw + ((t-T)/ANIM)*(PAD+tw), PAD)'` (fly from left)
   - `enable='gte(t,T)'`
   - Escape title text for drawtext (`:`, `\`, `'`)
5. Optional BGM: `amovie`/`aloop` + `amix` with clip audio (or BGM-only).

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from "vitest";
import { escapeDrawtext, buildRankingArgs } from "../src/rankingFfmpeg.js";

describe("escapeDrawtext", () => {
  it("escapes colon and quotes", () => {
    expect(escapeDrawtext("Top: Best")).toContain("\\:");
  });
});

describe("buildRankingArgs", () => {
  it("includes five inputs, concat, drawtext ranks, and nvenc", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "Top 5",
      titlePos: { x: 100, y: 80 },
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "h264_nvenc",
      output: "out.mp4",
    });
    expect(args.filter((x) => x === "-i")).toHaveLength(5);
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("concat=n=5");
    expect(fc).toMatch(/drawtext=.*text=5/);
    expect(fc).toMatch(/drawtext=.*text=1/);
    expect(fc).toContain("text='Top 5'");
    expect(args).toContain("h264_nvenc");
  });

  it("requires bgm when clips muted", () => {
    expect(() =>
      buildRankingArgs({
        clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
        durations: [1, 1, 1, 1, 1],
        title: "T",
        titlePos: { x: 10, y: 10 },
        muteClips: true,
        bgmPath: null,
        bgmVolume: 1,
        encoder: "libx264",
        output: "out.mp4",
      })
    ).toThrow(/background music/i);
  });
});
```

- [ ] **Step 2: Implement `rankingFfmpeg.js`** with `escapeDrawtext`, `buildVideoChain`, `buildRankingArgs` matching tests. Use `ANIM_SECONDS`, `CANVAS`, `buildSegments`, `stackPositions` from `rankingTimeline.js`. Prefer `-c:a aac` (not copy) after amix.

Key drawtext fragment pattern (per rank):

```js
function rankDrawtext({ rank, start, x, y, fontSize }) {
  const anim = 0.45;
  // PAD is final x; fly from -text_w
  return (
    `drawtext=fontfile=C\\\\:/Windows/Fonts/arialbd.ttf:text='${rank}':` +
    `fontsize=${fontSize}:fontcolor=white:borderw=4:bordercolor=black:` +
    `x='if(lt(t-${start}\\,${anim})\\,-tw+(t-${start})/${anim}*(${x}+tw)\\,${x})':` +
    `y=${y}:enable='gte(t\\,${start})'`
  );
}
```

On non-Windows, fall back to no `fontfile` (FFmpeg default) or `DejaVuSans-Bold.ttf` if present — detect `process.platform === 'win32'`.

- [ ] **Step 3: Run tests — PASS, commit**

```powershell
npm test --prefix server
git add server/src/rankingFfmpeg.js server/test/rankingFfmpeg.test.js
git commit -m "Add FFmpeg ranking export argument builder"
```

---

### Task 4: Ranking jobs + API routes

**Files:**
- Modify: `server/src/paths.js`
- Create: `server/src/rankingJobs.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Extend paths**

```js
export const rankingDir = path.join(root, "ranking");
export const rankingClipsDir = path.join(rankingDir, "clips");
export const rankingBgmDir = path.join(rankingDir, "bgm");

export function ensureDirs() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.mkdirSync(rankingClipsDir, { recursive: true });
  fs.mkdirSync(rankingBgmDir, { recursive: true });
}
```

- [ ] **Step 2: Implement `rankingJobs.js`**

Mirror `jobs.js` patterns:
- `createRankingJob({ clipPaths, durations, title, titlePos, muteClips, bgmPath, bgmVolume, encoder })`
- spawn ffmpeg with `buildRankingArgs`
- on NVENC failure retry once with `libx264`
- progress via `time=` / total duration
- `cancelRankingJob`, `getRankingJob`, `listPublicRankingJob`

- [ ] **Step 3: Add routes in `index.js`**

| Method | Path | Body / behavior |
|--------|------|-----------------|
| POST | `/api/ranking/clips` | multipart field `file` → save under ranking/clips → probe duration/size → `{ id, path, duration, width, height }` |
| POST | `/api/ranking/bgm` | multipart music → `{ id, path }` |
| POST | `/api/ranking/export` | JSON `{ clipIds: string[5], title, titlePos:{x,y}, muteClips, bgmId?, bgmVolume }` → validate 5 ids → start job → `{ jobId }` |
| GET | `/api/ranking/jobs/:id` | status |
| POST | `/api/ranking/jobs/:id/cancel` | cancel |
| GET | `/api/ranking/jobs/:id/download` | file when done |

Store clip metadata in a `Map` like watermark uploads (id → { path, duration, ... }).

`titlePos` is in **canvas pixels** (1080×1920 space). Client converts from preview CSS pixels.

- [ ] **Step 4: Manual health smoke**

```powershell
npm run dev --prefix server
curl.exe -s http://127.0.0.1:8787/api/health
```

Expected: `ok: true`.

- [ ] **Step 5: Commit**

```powershell
git add server/src/paths.js server/src/rankingJobs.js server/src/index.js
git commit -m "Add ranking upload and export API"
```

---

### Task 5: Ranking UI — slots, title, audio, export wiring

**Files:**
- Create: `client/src/components/ranking/ClipSlots.tsx`
- Create: `client/src/components/ranking/TitleOverlay.tsx`
- Create: `client/src/components/ranking/AudioControls.tsx`
- Create: `client/src/components/ranking/RankingPreview.tsx`
- Modify: `client/src/pages/RankingPage.tsx`
- Modify: `client/src/api.ts`
- Modify: `client/src/styles.css`

- [ ] **Step 1: Extend `api.ts`**

```ts
export type RankingClip = {
  id: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
};

export async function uploadRankingClip(file: File): Promise<RankingClip> { /* FormData -> /api/ranking/clips */ }
export async function uploadRankingBgm(file: File): Promise<{ id: string }> { /* ... */ }
export async function startRankingExport(body: {
  clipIds: string[];
  title: string;
  titlePos: { x: number; y: number };
  muteClips: boolean;
  bgmId?: string | null;
  bgmVolume: number;
}): Promise<{ jobId: string }> { /* POST /api/ranking/export */ }
export async function getRankingJob(jobId: string) { /* GET */ }
export async function cancelRankingJob(jobId: string) { /* POST */ }
export function rankingDownloadUrl(jobId: string) {
  return `/api/ranking/jobs/${jobId}/download`;
}
```

- [ ] **Step 2: `ClipSlots`** — 5 slots; each can upload; list is ordered; HTML5 drag-and-drop reorder between slots; show filename + duration; expose `clips: (RankingClip|null)[]` and `onReorder`.

- [ ] **Step 3: `TitleOverlay`** — absolute text on 9:16 stage; pointer drag updates `{x,y}` in stage CSS pixels; parent scales to canvas on export:

```ts
function toCanvasPos(pos: {x:number;y:number}, stageW: number, stageH: number) {
  return {
    x: Math.round((pos.x / stageW) * 1080),
    y: Math.round((pos.y / stageH) * 1920),
  };
}
```

- [ ] **Step 4: `AudioControls`** — checkbox “Mute clip audio”; file input for BGM; range for BGM volume (default 0.25). If mute and no BGM, show warning and disable export.

- [ ] **Step 5: `RankingPreview`** — 9:16 box (`aspect-ratio: 9/16`); play clips in list order using one `<video>` swapping `src` at ended; overlay CSS numbers that appear/stack from left matching ranks; show title at `titlePos`. Preview can be approximate; export is source of truth for animation timing.

- [ ] **Step 6: Wire `RankingPage`** — health banner; compose components; Export button enabled only when 5 clips present and audio rules satisfied; poll job; download link.

- [ ] **Step 7: Build client + commit**

```powershell
npm run build --prefix client
git add client
git commit -m "Add Ranking editor UI with preview and export controls"
```

---

### Task 6: End-to-end verify + docs

**Files:**
- Modify: `README.md`
- Modify: `.gitignore` if needed (`server/ranking/`)

- [ ] **Step 1: Ignore ranking temp media**

```
server/ranking/
```

- [ ] **Step 2: README section**

Document: open Ranking tab, upload 5 clips, reorder, title, audio modes, export. Note 9:16 / 1080×1920.

- [ ] **Step 3: Smoke test with 5 short generated clips**

```powershell
# generate 5 tiny clips, upload via curl, export, download
ffmpeg -y -f lavfi -i color=c=red:s=720x1280:d=1 -c:v libx264 -pix_fmt yuv420p server/ranking/clips/t1.mp4
# repeat colors for t2..t5, then call API export with muteClips=true + a short bgm beep
```

Expected: job `done`, downloadable mp4, playable, ranks visible.

- [ ] **Step 4: Confirm Watermark tab still loads and health works**

- [ ] **Step 5: Commit**

```powershell
git add README.md .gitignore
git commit -m "Document Ranking module and ignore ranking temp files"
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Separate module + nav | Task 1 |
| Exactly 5 clips, full length | Tasks 4–5 |
| Order 5→1 | Tasks 2, 5 |
| 9:16 export | Tasks 3–4 |
| Numbers fly left + stack | Tasks 2–3, 5 preview |
| Movable title | Task 5 |
| Audio modes A/B | Tasks 3–5 |
| Progress/cancel/errors | Task 4–5 |
| Watermark untouched in flow | Task 1 |

## Self-review notes

- No TBD placeholders; canvas size fixed at 1080×1920.
- Rank mapping consistent: list index 0 → rank 5.
- `titlePos` always canvas pixels on the wire.
- BGM required when `muteClips` is true (enforced in builder + UI).
