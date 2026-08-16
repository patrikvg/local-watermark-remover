# Ranking Title Toolbar & Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Viblo-like title toolbar (font, size, color, bold/regular, align, stroke) and clearer Ranking editor sections, with live preview and FFmpeg export using mapped Windows fonts.

**Architecture:** Introduce a shared font catalog (`titleFonts`) on server (file resolution + fallback) and client (CSS families). Extend title drawtext and the export API with style fields. Add `TitleControls` UI and restyle Ranking page sections without changing clip/rank/audio behavior or the existing app theme.

**Tech Stack:** Existing Vite + React client, Fastify server, Vitest, FFmpeg drawtext, Windows `C:/Windows/Fonts`.

**Spec:** `docs/superpowers/specs/2026-08-16-ranking-title-toolbar-layout-design.md`

---

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/titleFonts.js` | Font keys, bold/regular Windows paths, `resolveTitleFontFile`, `escapeFontfileOption` |
| `server/test/titleFonts.test.js` | Resolution + fallback tests |
| `server/src/rankingFfmpeg.js` | Style-aware `titleDrawtext` / `buildRankingArgs` |
| `server/test/rankingFfmpeg.test.js` | Assert fontsize/fontcolor/fontfile/align in filter |
| `server/src/rankingJobs.js` | Pass style fields on job |
| `server/src/index.js` | Validate/accept style fields on export |
| `client/src/titleFonts.ts` | Same keys + CSS `fontFamily` / labels for UI |
| `client/src/rankingLayout.ts` | Keep `TITLE_FONT` default; `estimateTitleBoxSize` accepts fontSize |
| `client/src/components/ranking/TitleControls.tsx` | Toolbar UI |
| `client/src/components/ranking/TitleOverlay.tsx` | Apply live styles |
| `client/src/components/ranking/RankingPreview.tsx` | Pass style props to overlay |
| `client/src/pages/RankingPage.tsx` | State, section order Title→Clips→Audio, export payload |
| `client/src/api.ts` | Export type fields |
| `client/src/styles.css` | Toolbar + section layout |

---

### Task 1: Server font catalog + tests

**Files:**
- Create: `server/src/titleFonts.js`
- Create: `server/test/titleFonts.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/test/titleFonts.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  TITLE_FONT_KEYS,
  resolveTitleFontFile,
  escapeFontfileOption,
} from "../src/titleFonts.js";

describe("titleFonts", () => {
  it("lists the five catalog keys", () => {
    expect(TITLE_FONT_KEYS).toEqual([
      "arial",
      "impact",
      "segoe",
      "georgia",
      "consolas",
    ]);
  });

  it("resolves arial bold to arialbd.ttf on win32 path shape", () => {
    const path = resolveTitleFontFile("arial", "bold", {
      existsSync: (p) => p.replace(/\\/g, "/").endsWith("arialbd.ttf"),
      platform: "win32",
    });
    expect(path.replace(/\\/g, "/")).toMatch(/Windows\/Fonts\/arialbd\.ttf$/i);
  });

  it("falls back to arialbd when chosen file is missing", () => {
    const path = resolveTitleFontFile("georgia", "bold", {
      existsSync: (p) => p.replace(/\\/g, "/").endsWith("arialbd.ttf"),
      platform: "win32",
    });
    expect(path.replace(/\\/g, "/")).toMatch(/arialbd\.ttf$/i);
  });

  it("uses impact.ttf for both weights when present", () => {
    const path = resolveTitleFontFile("impact", "bold", {
      existsSync: (p) => p.replace(/\\/g, "/").toLowerCase().includes("impact.ttf"),
      platform: "win32",
    });
    expect(path.replace(/\\/g, "/").toLowerCase()).toMatch(/impact\.ttf$/);
  });

  it("builds escaped fontfile= option for drawtext", () => {
    const opt = escapeFontfileOption("C:/Windows/Fonts/arialbd.ttf");
    expect(opt).toBe("fontfile='C\\:/Windows/Fonts/arialbd.ttf':");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

Run: `npm test --prefix server -- titleFonts`

Expected: FAIL cannot find module / no test file until Step 3.

- [ ] **Step 3: Implement `server/src/titleFonts.js`**

```js
import fs from "node:fs";
import path from "node:path";

export const TITLE_FONT_KEYS = [
  "arial",
  "impact",
  "segoe",
  "georgia",
  "consolas",
];

const WIN_FONTS = "C:/Windows/Fonts";

/** @type {Record<string, { regular: string, bold: string }>} */
const FILES = {
  arial: { regular: "arial.ttf", bold: "arialbd.ttf" },
  impact: { regular: "impact.ttf", bold: "impact.ttf" },
  segoe: { regular: "segoeui.ttf", bold: "segoeuib.ttf" },
  georgia: { regular: "georgia.ttf", bold: "georgiab.ttf" },
  consolas: { regular: "consola.ttf", bold: "consolab.ttf" },
};

const FALLBACK = path.join(WIN_FONTS, "arialbd.ttf");

/**
 * @param {string} fontKey
 * @param {"regular"|"bold"} weight
 * @param {{ existsSync?: (p: string) => boolean, platform?: string }} [deps]
 */
export function resolveTitleFontFile(fontKey, weight, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  const platform = deps.platform || process.platform;
  if (platform !== "win32") {
    return FALLBACK;
  }
  const key = TITLE_FONT_KEYS.includes(fontKey) ? fontKey : "arial";
  const w = weight === "regular" ? "regular" : "bold";
  const file = FILES[key][w];
  const full = path.join(WIN_FONTS, file);
  if (existsSync(full)) return full;
  if (existsSync(FALLBACK)) return FALLBACK;
  return full;
}

export function escapeFontfileOption(absolutePath) {
  const escaped = String(absolutePath).replace(/\\/g, "/").replace(/:/g, "\\:");
  return `fontfile='${escaped}':`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test --prefix server -- titleFonts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/titleFonts.js server/test/titleFonts.test.js
git commit -m "Add Windows title font catalog with fallback"
```

---

### Task 2: Style-aware title drawtext + tests

**Files:**
- Modify: `server/src/rankingFfmpeg.js`
- Modify: `server/test/rankingFfmpeg.test.js`

- [ ] **Step 1: Add failing tests for styled title**

Append to `server/test/rankingFfmpeg.test.js`:

```js
  it("applies title font size color file and center align", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "Top 5",
      titlePos: { x: 100, y: 80 },
      titleWidth: 900,
      titleFont: "arial",
      titleSize: 72,
      titleWeight: "bold",
      titleColor: "#ffcc00",
      titleAlign: "center",
      titleBorder: 4,
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "libx264",
      output: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/fontsize=72/);
    expect(fc).toMatch(/fontcolor=#ffcc00|fontcolor=0x[Ff]{2}[Cc]{2}00/);
    expect(fc).toMatch(/fontfile=/);
    expect(fc).toMatch(/borderw=4/);
    // center: x uses titlePos + (boxW-tw)/2
    expect(fc).toMatch(/100\+\(900-tw\)\/2|100\+\(900-text_w\)\/2/);
  });
```

Normalize color in implementation to either `#ffcc00` (if FFmpeg accepts) or `0xFFCC00`. Prefer **`#ffcc00`** if tests on this machine’s FFmpeg docs allow hex with `#`; otherwise convert to `0xFFCC00` and adjust the test to expect `0xFFCC00`.

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test --prefix server -- rankingFfmpeg`

Expected: FAIL on missing fontsize=72 / align expression.

- [ ] **Step 3: Update `titleDrawtext` and call sites**

In `server/src/rankingFfmpeg.js`:

1. Import `resolveTitleFontFile`, `escapeFontfileOption` from `./titleFonts.js`.
2. Keep `fontfileOption()` for ranks/captions (Arial Bold) OR switch ranks to still use hard-coded arialbd via `escapeFontfileOption(resolveTitleFontFile("arial","bold"))`.
3. Replace `titleDrawtext` with:

```js
function normalizeFontColor(color) {
  const raw = String(color || "#ffffff").trim();
  const m = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return "white";
  return `0x${m[1].toUpperCase()}`;
}

function titleDrawtext({
  title,
  x,
  y,
  borderW,
  boxWidth,
  fontKey = "arial",
  fontSize = TITLE_FONT,
  weight = "bold",
  color = "#ffffff",
  align = "left",
}) {
  const file = resolveTitleFontFile(fontKey, weight === "regular" ? "regular" : "bold");
  const font = escapeFontfileOption(file);
  const escaped = escapeDrawtext(title);
  const bw = Math.max(0, Math.round(Number(borderW) || 0));
  const size = Math.max(12, Math.round(Number(fontSize) || TITLE_FONT));
  const boxW = Math.max(1, Math.round(Number(boxWidth) || DEFAULT_TITLE_WIDTH));
  const fontcolor = normalizeFontColor(color);
  let xExpr = String(Math.round(Number(x) || 0));
  if (align === "center") {
    xExpr = `${Math.round(Number(x) || 0)}+(${boxW}-tw)/2`;
  } else if (align === "right") {
    xExpr = `${Math.round(Number(x) || 0)}+${boxW}-tw`;
  }
  return (
    `drawtext=${font}text='${escaped}':` +
    `fontsize=${size}:fontcolor=${fontcolor}:borderw=${bw}:bordercolor=black:` +
    `line_spacing=${TITLE_LINE_SPACING}:x=${xExpr}:y=${Math.round(Number(y) || 0)}`
  );
}
```

4. Pass new fields from `buildRankingFilter` / `buildRankingArgs` into `titleDrawtext` (`titleFont`, `titleSize`, `titleWeight`, `titleColor`, `titleAlign`, `titleWidth`).
5. Update the failing test to match `0xFFCC00` and `100+(900-tw)/2`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test --prefix server -- rankingFfmpeg`

Expected: PASS (including existing cases with defaults).

- [ ] **Step 5: Commit**

```bash
git add server/src/rankingFfmpeg.js server/test/rankingFfmpeg.test.js
git commit -m "Style ranking title drawtext with font size color align"
```

---

### Task 3: API + job pass-through

**Files:**
- Modify: `server/src/index.js`
- Modify: `server/src/rankingJobs.js`
- Modify: `client/src/api.ts`

- [ ] **Step 1: Extend `startRankingExport` body type in `client/src/api.ts`**

Add optional fields:

```ts
  titleFont?: "arial" | "impact" | "segoe" | "georgia" | "consolas";
  titleSize?: number;
  titleWeight?: "regular" | "bold";
  titleColor?: string;
  titleAlign?: "left" | "center" | "right";
```

- [ ] **Step 2: Accept fields in `server/src/index.js` export route**

Destructure `titleFont`, `titleSize`, `titleWeight`, `titleColor`, `titleAlign` from body. Light validation:

- `titleFont` must be one of the five keys or omit → default `arial`
- `titleWeight` `regular`|`bold` or default `bold`
- `titleAlign` `left`|`center`|`right` or default `left`
- `titleSize` finite number 12–200 or default `64`
- `titleColor` string matching `/^#?[0-9a-fA-F]{6}$/` or default `#ffffff`

Pass into `createRankingJob(...)`.

- [ ] **Step 3: Store and forward in `rankingJobs.js`**

Add the same fields on the job object and pass them into `buildRankingArgs` / filter builder.

- [ ] **Step 4: Commit**

```bash
git add client/src/api.ts server/src/index.js server/src/rankingJobs.js
git commit -m "Pass title style fields through ranking export API"
```

---

### Task 4: Client font catalog + overlay styles

**Files:**
- Create: `client/src/titleFonts.ts`
- Modify: `client/src/rankingLayout.ts` (`estimateTitleBoxSize` takes `fontSize`)
- Modify: `client/src/components/ranking/TitleOverlay.tsx`
- Modify: `client/src/components/ranking/RankingPreview.tsx`

- [ ] **Step 1: Create `client/src/titleFonts.ts`**

```ts
export const TITLE_FONT_OPTIONS = [
  { id: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { id: "impact", label: "Impact", css: "Impact, Haettenschweiler, sans-serif" },
  { id: "segoe", label: "Segoe UI", css: '"Segoe UI", Tahoma, sans-serif" },
  { id: "georgia", label: "Georgia", css: "Georgia, serif" },
  { id: "consolas", label: "Consolas", css: "Consolas, monospace" },
] as const;

export type TitleFontId = (typeof TITLE_FONT_OPTIONS)[number]["id"];

export function cssFamilyForTitleFont(id: TitleFontId | string) {
  return (
    TITLE_FONT_OPTIONS.find((f) => f.id === id)?.css ??
    TITLE_FONT_OPTIONS[0].css
  );
}
```

- [ ] **Step 2: Update `estimateTitleBoxSize` to accept canvas font size**

Change signature to:

```ts
export function estimateTitleBoxSize(
  title: string,
  boxWidthPreview: number,
  wrap: boolean,
  scale: number,
  fontSizeCanvas = TITLE_FONT
)
```

Use `fontSizeCanvas` instead of `TITLE_FONT` for wrap/height/nowrap width math. Update `RankingPage.onCenterTitle` to pass `titleSize` once that state exists (Task 5); for now default still works.

- [ ] **Step 3: Extend TitleOverlay props**

Add:

```ts
  fontFamilyCss: string;
  fontSizeCanvas: number; // canvas px; multiply by scale for CSS
  fontWeight: "regular" | "bold";
  color: string;
  align: "left" | "center" | "right";
```

Apply in style:

```ts
fontFamily: fontFamilyCss,
fontSize: fontSizeCanvas * s,
fontWeight: fontWeight === "bold" ? 700 : 400,
color,
textAlign: align,
```

Use `fontSizeCanvas` (not `TITLE_FONT`) in `wrapOverlayText` / lineHeight / `effectiveW` estimates.

- [ ] **Step 4: Thread props through RankingPreview**

Add the same style props to `RankingPreview` and pass them into `TitleOverlay`.

- [ ] **Step 5: Build check**

Run: `npm run build --prefix client`  
(May fail until RankingPage supplies props — if so, add temporary defaults in RankingPreview props destructuring.)

- [ ] **Step 6: Commit**

```bash
git add client/src/titleFonts.ts client/src/rankingLayout.ts client/src/components/ranking/TitleOverlay.tsx client/src/components/ranking/RankingPreview.tsx
git commit -m "Apply live title font styles in ranking preview overlay"
```

---

### Task 5: TitleControls + RankingPage layout

**Files:**
- Create: `client/src/components/ranking/TitleControls.tsx`
- Modify: `client/src/pages/RankingPage.tsx`
- Modify: `client/src/styles.css`

- [ ] **Step 1: Implement TitleControls**

```tsx
import {
  TITLE_FONT_OPTIONS,
  type TitleFontId,
} from "../../titleFonts";

type Props = {
  font: TitleFontId;
  onFontChange: (v: TitleFontId) => void;
  size: number;
  onSizeChange: (v: number) => void;
  weight: "regular" | "bold";
  onWeightChange: (v: "regular" | "bold") => void;
  color: string;
  onColorChange: (v: string) => void;
  align: "left" | "center" | "right";
  onAlignChange: (v: "left" | "center" | "right") => void;
  border: number;
  onBorderChange: (v: number) => void;
  disabled?: boolean;
};

export default function TitleControls({ ... }: Props) {
  return (
    <div className="title-toolbar">
      <label>
        <span className="sr-only">Font</span>
        <select
          value={font}
          disabled={disabled}
          onChange={(e) => onFontChange(e.target.value as TitleFontId)}
        >
          {TITLE_FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Size</span>
        <input
          type="number"
          min={24}
          max={120}
          step={2}
          value={size}
          disabled={disabled}
          onChange={(e) => onSizeChange(Number(e.target.value))}
        />
      </label>
      <button
        type="button"
        className={weight === "bold" ? "is-active" : ""}
        disabled={disabled}
        aria-pressed={weight === "bold"}
        onClick={() =>
          onWeightChange(weight === "bold" ? "regular" : "bold")
        }
      >
        B
      </button>
      <div className="title-align">
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={align === a ? "is-active" : ""}
            disabled={disabled}
            aria-pressed={align === a}
            onClick={() => onAlignChange(a)}
          >
            {a[0].toUpperCase()}
          </button>
        ))}
      </div>
      <label>
        <span className="sr-only">Color</span>
        <input
          type="color"
          value={color.startsWith("#") ? color : `#${color}`}
          disabled={disabled}
          onChange={(e) => onColorChange(e.target.value)}
        />
      </label>
      <label className="title-stroke">
        <span>Stroke</span>
        <input
          type="range"
          min={0}
          max={12}
          step={1}
          value={border}
          disabled={disabled}
          onChange={(e) => onBorderChange(Number(e.target.value))}
        />
        <span className="time">{border}px</span>
      </label>
    </div>
  );
}
```

If `.sr-only` does not exist, add a minimal CSS rule (visually hidden).

- [ ] **Step 2: Wire RankingPage state**

```ts
const [titleFont, setTitleFont] = useState<TitleFontId>("arial");
const [titleSize, setTitleSize] = useState(64);
const [titleWeight, setTitleWeight] = useState<"regular" | "bold">("bold");
const [titleColor, setTitleColor] = useState("#ffffff");
const [titleAlign, setTitleAlign] = useState<"left" | "center" | "right">("left");
```

Reorder editor column: **Title section first** (toolbar + textarea + wrap + Mitte), then Clips, then Audio.

Pass styles into `RankingPreview`. Include in `startRankingExport({...})`. Update `onCenterTitle` to pass `titleSize` into `estimateTitleBoxSize`.

- [ ] **Step 3: CSS for toolbar + sections**

Append to `styles.css` (match existing dark theme variables — no light Viblo cards):

```css
.title-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.title-toolbar select,
.title-toolbar input[type="number"] {
  max-width: 8rem;
}

.title-toolbar button.is-active {
  outline: 1px solid var(--accent, #6ea8fe);
}

.title-align {
  display: inline-flex;
  gap: 0.15rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.ranking-editor-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
```

Wrap Title / Clips / Audio blocks in `div.ranking-editor-section` with `h2.section-title`.

- [ ] **Step 4: Build**

Run: `npm run build --prefix client`  
Expected: success

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ranking/TitleControls.tsx client/src/pages/RankingPage.tsx client/src/styles.css
git commit -m "Add title toolbar and Title-first ranking editor layout"
```

---

### Task 6: End-to-end verification

**Files:** none (verify)

- [ ] **Step 1: Server tests**

Run: `npm test --prefix server`  
Expected: all PASS including `titleFonts` + styled drawtext

- [ ] **Step 2: Client build**

Run: `npm run build --prefix client`  
Expected: success

- [ ] **Step 3: Manual checklist (code + optional UI)**

- [ ] Title section above Clips; preview sticky  
- [ ] Font/size/color/B/align update overlay live  
- [ ] Stroke slider still works  
- [ ] Mitte + snap still work with new fontSize  
- [ ] Export payload includes style fields; filter contains fontsize/fontcolor/fontfile  

- [ ] **Step 4: Polish commit only if needed**

```bash
git add -u client/src server/src server/test
git commit -m "Polish ranking title toolbar UX"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| Title toolbar controls | Task 5 |
| Layout Title → Clips → Audio \| Preview | Task 5 |
| Live preview styles | Task 4 |
| Export font/size/color/weight/align/stroke | Tasks 2–3 |
| Font catalog + fallback | Task 1 |
| Existing theme (no light cards) | Task 5 CSS |
| Keep snap/Mitte/player/clips | unchanged; Task 4–5 preserve |
| Italic / height% / emoji out of scope | — |

**Placeholder scan:** none.  
**Type consistency:** `titleFont` / `titleSize` / `titleWeight` / `titleColor` / `titleAlign` used end-to-end; font ids match `TITLE_FONT_KEYS` / `TITLE_FONT_OPTIONS`.
