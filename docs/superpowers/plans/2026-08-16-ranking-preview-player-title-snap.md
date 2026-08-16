# Ranking Preview Player & Title Snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Ranking preview transport controls inside the 9:16 stage (YouTube-style idle hide) and add magnetic horizontal title snap plus a Center button (X always, Y on button).

**Architecture:** Keep all logic in the existing React preview. Add tiny pure helpers in `rankingLayout.ts` for center math. Relocate the transport DOM into `.ranking-stage`, drive show/hide with an idle timer, and extend `TitleOverlay` drag math with a snap threshold + guide line. No server/export changes.

**Tech Stack:** Vite + React client, existing `rankingLayout.ts`, CSS in `styles.css`, Vitest on server for pure center-math contract tests.

**Spec:** `docs/superpowers/specs/2026-08-16-ranking-preview-player-title-snap-design.md`

---

## File map

| Path | Responsibility |
|------|----------------|
| `client/src/rankingLayout.ts` | Add `TITLE_SNAP_THRESHOLD`, `centerTitleX`, `centerTitleY`, `estimateTitleBoxSize` |
| `server/test/titleCenter.test.js` | Contract tests for the same center formulas (must stay in sync with client helpers) |
| `client/src/components/ranking/TitleOverlay.tsx` | Magnetic X snap while dragging; vertical center guide |
| `client/src/pages/RankingPage.tsx` | **Mitte** button that sets exact X+Y center |
| `client/src/components/ranking/RankingPreview.tsx` | In-stage transport overlay; idle hide; click-to-play |
| `client/src/styles.css` | Overlay transport, idle fade, snap guide |

---

### Task 1: Center math helpers + contract tests

**Files:**
- Modify: `client/src/rankingLayout.ts`
- Create: `server/test/titleCenter.test.js`

- [ ] **Step 1: Write the failing contract test**

Create `server/test/titleCenter.test.js`:

```js
import { describe, expect, it } from "vitest";

/** Keep in sync with client/src/rankingLayout.ts centerTitleX/Y */
function centerTitleX(stageWidth, boxWidth) {
  return Math.max(0, (Number(stageWidth) - Number(boxWidth)) / 2);
}

function centerTitleY(stageHeight, boxHeight) {
  return Math.max(0, (Number(stageHeight) - Number(boxHeight)) / 2);
}

describe("titleCenter", () => {
  it("centers X for a box narrower than the stage", () => {
    expect(centerTitleX(270, 210)).toBe(30);
  });

  it("clamps X to 0 when box is wider than the stage", () => {
    expect(centerTitleX(200, 240)).toBe(0);
  });

  it("centers Y for a short box", () => {
    expect(centerTitleY(480, 80)).toBe(200);
  });

  it("clamps Y to 0 when box is taller than the stage", () => {
    expect(centerTitleY(100, 140)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the contract test**

Run: `npm test --prefix server -- titleCenter`

Expected: PASS (inline helpers lock the formula). Proceed to mirror the same math on the client in Step 3.

- [ ] **Step 3: Add matching helpers to `rankingLayout.ts`**

Append to `client/src/rankingLayout.ts`:

```ts
/** Preview px distance from exact center before magnetic snap engages. */
export const TITLE_SNAP_THRESHOLD = 8;

export function centerTitleX(stageWidth: number, boxWidth: number) {
  return Math.max(0, (Number(stageWidth) - Number(boxWidth)) / 2);
}

export function centerTitleY(stageHeight: number, boxHeight: number) {
  return Math.max(0, (Number(stageHeight) - Number(boxHeight)) / 2);
}

/** Estimate title box size in preview px (same wrap model as TitleOverlay). */
export function estimateTitleBoxSize(
  title: string,
  boxWidthPreview: number,
  wrap: boolean,
  scale: number
) {
  const s = Math.max(0.05, scale);
  const canvasWidth = boxWidthPreview / s;
  const display = wrapOverlayText(title || "Title", canvasWidth, TITLE_FONT, wrap);
  const heightCanvas = overlayTextHeight(display, TITLE_FONT, TITLE_LINE_SPACING);
  const widthCanvas = wrap
    ? canvasWidth
    : Math.max(
        1,
        String(display).length * TITLE_FONT * CHAR_WIDTH_RATIO
      );
  return {
    width: widthCanvas * s,
    height: heightCanvas * s,
  };
}
```

- [ ] **Step 4: Re-run contract tests**

Run: `npm test --prefix server -- titleCenter`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/rankingLayout.ts server/test/titleCenter.test.js
git commit -m "Add title center helpers and contract tests"
```

---

### Task 2: Magnetic horizontal snap + guide in TitleOverlay

**Files:**
- Modify: `client/src/components/ranking/TitleOverlay.tsx`
- Modify: `client/src/styles.css`

- [ ] **Step 1: Extend TitleOverlay props and snap on drag**

Replace `client/src/components/ranking/TitleOverlay.tsx` with:

```tsx
import { useRef, useState } from "react";
import {
  CHAR_WIDTH_RATIO,
  TITLE_FONT,
  TITLE_LINE_SPACING,
  TITLE_SNAP_THRESHOLD,
  centerTitleX,
  wrapOverlayText,
} from "../../rankingLayout";

type Props = {
  title: string;
  pos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
  borderWidth: number;
  boxWidth: number;
  onBoxWidthChange: (width: number) => void;
  wrap: boolean;
  scale: number;
  stageWidth: number;
};

const MIN_W = 48;

export default function TitleOverlay({
  title,
  pos,
  onPosChange,
  borderWidth,
  boxWidth,
  onBoxWidthChange,
  wrap,
  scale,
  stageWidth,
}: Props) {
  const dragging = useRef(false);
  const resizing = useRef(false);
  const origin = useRef({
    pointerX: 0,
    pointerY: 0,
    startX: 0,
    startY: 0,
    startW: 0,
  });
  const [snappedX, setSnappedX] = useState(false);
  const s = Math.max(0.05, scale);
  const bw = Math.max(0, borderWidth) * s;
  const canvasWidth = boxWidth / s;
  const display = wrapOverlayText(title || "Title", canvasWidth, TITLE_FONT, wrap);
  const effectiveW = wrap
    ? boxWidth
    : Math.max(
        MIN_W,
        String(display).length * TITLE_FONT * CHAR_WIDTH_RATIO * s
      );

  return (
    <>
      {snappedX ? (
        <div
          className="ranking-snap-guide"
          style={{ left: stageWidth / 2 }}
          aria-hidden
        />
      ) : null}
      <div
        className={"ranking-title" + (wrap ? "" : " is-nowrap")}
        style={{
          left: pos.x,
          top: pos.y,
          width: wrap ? boxWidth : undefined,
          fontSize: TITLE_FONT * s,
          lineHeight: `${(TITLE_FONT + TITLE_LINE_SPACING) * s}px`,
          WebkitTextStroke: bw > 0 ? `${bw}px black` : undefined,
          paintOrder: "stroke fill",
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          origin.current = {
            pointerX: e.clientX,
            pointerY: e.clientY,
            startX: pos.x,
            startY: pos.y,
            startW: boxWidth,
          };
        }}
        onPointerMove={(e) => {
          if (resizing.current) {
            const dx = e.clientX - origin.current.pointerX;
            onBoxWidthChange(Math.max(MIN_W, origin.current.startW + dx));
            return;
          }
          if (!dragging.current) return;
          const dx = e.clientX - origin.current.pointerX;
          const dy = e.clientY - origin.current.pointerY;
          let nextX = Math.max(0, origin.current.startX + dx);
          const nextY = Math.max(0, origin.current.startY + dy);
          const cx = centerTitleX(stageWidth, effectiveW);
          const near = Math.abs(nextX - cx) <= TITLE_SNAP_THRESHOLD;
          if (near) nextX = cx;
          setSnappedX(near);
          onPosChange({ x: nextX, y: nextY });
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          resizing.current = false;
          setSnappedX(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragging.current = false;
          resizing.current = false;
          setSnappedX(false);
        }}
      >
        {display}
        <span
          className="ranking-overlay-handle"
          aria-hidden
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
            resizing.current = true;
            dragging.current = false;
            setSnappedX(false);
            origin.current = {
              pointerX: e.clientX,
              pointerY: e.clientY,
              startX: pos.x,
              startY: pos.y,
              startW: boxWidth,
            };
          }}
        />
      </div>
    </>
  );
}
```

**Important:** When implementing, merge into the real file — keep a single import line including `CHAR_WIDTH_RATIO`. Do not leave the comment stub. For wrap mode use `boxWidth` as `effectiveW`; for nowrap use the character-width estimate above.

- [ ] **Step 2: Pass `stageWidth` from RankingPreview**

In `RankingPreview.tsx`, update the `TitleOverlay` call:

```tsx
<TitleOverlay
  title={title}
  pos={titlePos}
  onPosChange={onTitlePosChange}
  borderWidth={titleBorder}
  boxWidth={titleWidth}
  onBoxWidthChange={onTitleWidthChange}
  wrap={titleWrap}
  scale={scale}
  stageWidth={stageW}
/>
```

- [ ] **Step 3: Add snap-guide CSS**

Append to `client/src/styles.css`:

```css
.ranking-snap-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  transform: translateX(-50%);
  background: rgba(80, 200, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  z-index: 4;
  pointer-events: none;
}
```

- [ ] **Step 4: Manual check**

Run: `npm run dev`  
Open Ranking, fill title, drag near horizontal center — guide appears and X locks; drag away — free move, guide gone.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ranking/TitleOverlay.tsx client/src/components/ranking/RankingPreview.tsx client/src/styles.css
git commit -m "Add magnetic horizontal snap for ranking title"
```

---

### Task 3: Center button on RankingPage

**Files:**
- Modify: `client/src/pages/RankingPage.tsx`
- Modify: `client/src/styles.css` (optional small button row spacing)

- [ ] **Step 1: Import helpers and add center handler**

At top of `RankingPage.tsx`, extend the rankingLayout import (or add):

```ts
import {
  CANVAS,
  TITLE_FONT,
  estimateTitleBoxSize,
  centerTitleX,
  centerTitleY,
  toCanvasLen,
  toCanvasPos,
} from "../rankingLayout";
```

Inside the component (near other handlers):

```ts
function onCenterTitle() {
  const { width: stageW, height: stageH } = stageSizeRef.current;
  if (stageW <= 0 || stageH <= 0) return;
  const scale = stageW / CANVAS.width;
  const box = estimateTitleBoxSize(title, titleWidth, titleWrap, scale);
  setTitlePos({
    x: centerTitleX(stageW, box.width),
    y: centerTitleY(stageH, box.height),
  });
}
```

- [ ] **Step 2: Add the button in the Title section**

Place after the title border slider (before `AudioControls`):

```tsx
<button
  type="button"
  className="ghost"
  disabled={busy || processing}
  onClick={onCenterTitle}
>
  Mitte
</button>
```

If `.ghost` does not exist in this project, use:

```tsx
<button type="button" disabled={busy || processing} onClick={onCenterTitle}>
  Mitte
</button>
```

- [ ] **Step 3: Manual check**

With preview visible, move title off-center, click **Mitte** — title sits in exact horizontal and vertical middle. Change wrap width, click again — recenters for new size.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/RankingPage.tsx
git commit -m "Add Mitte button to center ranking title"
```

---

### Task 4: Move transport into the stage (YouTube-style idle)

**Files:**
- Modify: `client/src/components/ranking/RankingPreview.tsx`
- Modify: `client/src/styles.css`

- [ ] **Step 1: Add idle / chrome state and pointer handlers**

Inside `RankingPreview`, add state and refs near other hooks:

```ts
const [chromeVisible, setChromeVisible] = useState(true);
const idleTimer = useRef<number | null>(null);

function bumpChrome() {
  setChromeVisible(true);
  if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
  idleTimer.current = window.setTimeout(() => {
    if (!scrubbing.current) setChromeVisible(false);
  }, 2000);
}

useEffect(() => {
  return () => {
    if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
  };
}, []);
```

- [ ] **Step 2: Move transport markup inside `.ranking-stage`**

Remove the outer `.ranking-transport` block below the stage. Inside `.ranking-stage`, after `TitleOverlay`, add:

```tsx
<div
  className={
    "ranking-transport-overlay" + (chromeVisible ? " is-visible" : "")
  }
  onPointerDown={(e) => e.stopPropagation()}
>
  <div className="ranking-transport-row">
    <button type="button" disabled={!playable} onClick={onPlayPause}>
      {playing ? "Pause" : "Play"}
    </button>
    <input
      type="range"
      min={0}
      max={Math.max(0.01, totalDuration)}
      step={0.05}
      value={Math.min(timeline, totalDuration || 0)}
      disabled={!playable}
      aria-label="Seek"
      onPointerDown={() => {
        scrubbing.current = true;
        bumpChrome();
      }}
      onPointerUp={() => {
        scrubbing.current = false;
        bumpChrome();
      }}
      onChange={(e) => {
        seekTo(Number(e.target.value));
        bumpChrome();
      }}
    />
    <span className="ranking-time">
      {playable
        ? `${formatTime(timeline)} / ${formatTime(totalDuration)}`
        : "0:00 / 0:00"}
    </span>
  </div>
</div>
```

Keep the clip hint **outside** the stage (under `.ranking-stage-wrap`):

```tsx
<span className="hint">
  {playable
    ? `Clip ${clipIndex + 1}/5 · rank #${rankForIndex(clipIndex)}`
    : "Fill every slot first"}
</span>
```

- [ ] **Step 3: Wire stage pointer activity + click-to-play**

On the stage `div` (`ref={stageRef}`), add:

```tsx
onPointerMove={() => bumpChrome()}
onPointerDown={() => bumpChrome()}
onClick={(e) => {
  const t = e.target as HTMLElement;
  if (
    t.closest(".ranking-title") ||
    t.closest(".ranking-rank-stack") ||
    t.closest(".ranking-transport-overlay")
  ) {
    return;
  }
  onPlayPause();
}}
```

Call `bumpChrome()` once when `playable` becomes true (optional `useEffect` on `playable`).

- [ ] **Step 4: CSS for overlay + idle**

Replace / extend transport styles in `client/src/styles.css`:

```css
.ranking-transport-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  padding: 1.5rem 0.55rem 0.55rem;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.ranking-transport-overlay.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.ranking-transport-overlay .ranking-transport-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.ranking-transport-overlay .ranking-transport-row input[type="range"] {
  flex: 1;
  min-width: 0;
}

.ranking-transport-overlay .ranking-time {
  flex: 0 0 auto;
  min-width: 5.2rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.85);
}

.ranking-transport-overlay button {
  flex: 0 0 auto;
}
```

Remove unused rules for the old external `.ranking-transport` if nothing else uses them, or leave harmless.

- [ ] **Step 5: Manual check**

1. Controls sit inside the video frame.  
2. After ~2s idle they fade out; hover/move brings them back.  
3. Scrubbing keeps them visible.  
4. Click empty video toggles play; dragging title does not toggle.  
5. Seek across clip boundaries still works.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ranking/RankingPreview.tsx client/src/styles.css
git commit -m "Move ranking preview transport into video overlay"
```

---

### Task 5: End-to-end verification

**Files:** none (manual + tests)

- [ ] **Step 1: Run automated tests**

Run: `npm test --prefix server -- titleCenter`

Expected: PASS

- [ ] **Step 2: Run client typecheck/build**

Run: `npm run build --prefix client`

Expected: success (no TS errors from new props / imports)

- [ ] **Step 3: Manual acceptance against spec**

Checklist:
- [ ] Transport inside 9:16; idle hide ~2s; hover shows again  
- [ ] Magnetic X snap + guide near center  
- [ ] **Mitte** sets exact X and Y center for current box  
- [ ] Export still works with unchanged API (smoke: start export if clips available)

- [ ] **Step 4: Final commit if any leftover polish**

Only if CSS/copy tweaks remain:

```bash
git add -u client/src
git commit -m "Polish ranking preview player and title snap UX"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Controls inside `.ranking-stage` | Task 4 |
| Idle ~2s hide; hover/tap show | Task 4 |
| Click video toggles play | Task 4 |
| Clip hint non-exported chrome | Task 4 (under stage) |
| Magnetic horizontal snap ±~8px | Task 1 threshold + Task 2 |
| Vertical guide while snapped | Task 2 |
| Center button: exact X + Y | Task 3 |
| No rank-stack snap | — (not implemented) |
| No server/export changes | — (no server src edits except test) |

**Placeholder scan:** none.  
**Type consistency:** `centerTitleX` / `centerTitleY` / `TITLE_SNAP_THRESHOLD` / `estimateTitleBoxSize` / `stageWidth` prop used consistently across tasks.
