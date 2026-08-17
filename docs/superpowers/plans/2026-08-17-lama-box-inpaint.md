# LaMa Box Inpaint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FFmpeg `delogo` as the default watermark path with local LaMa inpainting on the user-drawn box crop, feathered back onto the source, NVENC encode unchanged.

**Architecture:** Node still owns upload/jobs/cancel/encode. New `fitInpaintRegion` builds crop + inner mask + per-side feather. FFmpeg extracts a PNG sequence of the crop, a Python worker (`simple-lama-inpainting`) fills those frames, FFmpeg overlays with edge alpha and encodes. Health reports whether the worker imports; process refuses to start without it (no silent delogo).

**Tech Stack:** Node 20 + Fastify + Vitest (existing), FFmpeg, Python 3.10+ venv, CUDA PyTorch, `simple-lama-inpainting==0.1.2`.

**Spec:** `docs/superpowers/specs/2026-08-17-lama-box-inpaint-design.md`

---

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/inpaintRegion.js` | Crop / mask / feather math from user box |
| `server/test/inpaintRegion.test.js` | Region math tests |
| `server/src/ffmpegArgs.js` | Add crop-extract, mask PNG, overlay-composite args; keep delogo builder |
| `server/test/ffmpegArgs.test.js` | Crop / mask / overlay / fps parse tests |
| `server/src/inpaint.js` | Find Python, `--check`, spawn worker, parse `frame i/n` |
| `server/test/inpaint.test.js` | Python resolve + progress parse tests |
| `server/src/jobs.js` | Three-phase job (crop → worker → overlay); cancel kills active child + temps |
| `server/test/jobsInpaint.test.js` | Cancel + progress mapping tests |
| `server/inpaint/geom.py` | Pad-to-8, long-side 720 |
| `server/inpaint/test_geom.py` | Stdlib unittest for geom |
| `server/inpaint/worker.py` | `--check` and frame-dir LaMa |
| `server/inpaint/requirements.txt` | `simple-lama-inpainting==0.1.2` |
| `server/src/index.js` | Health `inpaint`; process uses region + 503 if engine missing |
| `client/src/api.ts` | `Health.inpaint` |
| `client/src/pages/WatermarkPage.tsx` | KI banner |
| `client/src/components/VideoWorkspace.tsx` | Disable Remove when inpaint not ok |
| `README.md` | Python/CUDA setup |
| `.gitignore` | venv + models |

---

### Task 1: Inpaint region math

**Files:**
- Create: `server/test/inpaintRegion.test.js`
- Create: `server/src/inpaintRegion.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { fitInpaintRegion } from "../src/inpaintRegion.js";

describe("fitInpaintRegion", () => {
  it("expands a centered box by 24px and keeps the mask on the user box", () => {
    const r = fitInpaintRegion(
      { x: 200, y: 100, width: 80, height: 40 },
      1920,
      1080
    );
    expect(r.crop).toEqual({ x: 176, y: 76, w: 128, h: 88 });
    expect(r.mask).toEqual({ x: 24, y: 24, w: 80, h: 40 });
    expect(r.feather).toEqual({ left: 12, right: 12, top: 12, bottom: 12 });
  });

  it("clamps crop to the frame and shrinks feather on the clamped side", () => {
    const r = fitInpaintRegion(
      { x: 0, y: 0, width: 80, height: 40 },
      1920,
      1080
    );
    expect(r.crop.x).toBeGreaterThanOrEqual(1);
    expect(r.crop.y).toBeGreaterThanOrEqual(1);
    expect(r.crop.x + r.crop.w).toBeLessThanOrEqual(1919);
    expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(1079);
    expect(r.mask.x).toBeGreaterThanOrEqual(0);
    expect(r.mask.y).toBeGreaterThanOrEqual(0);
    expect(r.mask.x + r.mask.w).toBeLessThanOrEqual(r.crop.w);
    expect(r.mask.y + r.mask.h).toBeLessThanOrEqual(r.crop.h);
    expect(r.feather.left).toBeLessThanOrEqual(r.mask.x);
    expect(r.feather.top).toBeLessThanOrEqual(r.mask.y);
  });

  it("keeps a 4K bottom-right TikTok-style box in frame", () => {
    const r = fitInpaintRegion(
      { x: 3600, y: 2100, width: 220, height: 40 },
      3840,
      2160
    );
    expect(r.crop.x + r.crop.w).toBeLessThanOrEqual(3839);
    expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(2159);
    expect(r.crop.w).toBeGreaterThanOrEqual(16);
    expect(r.crop.h).toBeGreaterThanOrEqual(16);
  });

  it("fits a 1080×1920 vertical frame", () => {
    const r = fitInpaintRegion(
      { x: 40, y: 1800, width: 200, height: 80 },
      1080,
      1920
    );
    expect(r.crop.x).toBeGreaterThanOrEqual(1);
    expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(1919);
    expect(r.mask.w).toBeGreaterThanOrEqual(16);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix server -- test/inpaintRegion.test.js`

Expected: FAIL — cannot find `../src/inpaintRegion.js` or `fitInpaintRegion`.

- [ ] **Step 3: Write minimal implementation**

`server/src/inpaintRegion.js`:

```js
import { normalizeBox } from "./box.js";

function even(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return v % 2 === 0 ? v : v - 1;
}

function evenAtLeast(n, min) {
  let v = even(n);
  if (v < min) v = min % 2 === 0 ? min : min + 1;
  return v;
}

/**
 * Crop = user box expanded by `expand` (default 24), clamped inside a 1px
 * frame margin. Mask is the user box in crop coordinates. Feather on each
 * side is min(12, pad between mask and crop edge) so we never fade the hole.
 */
export function fitInpaintRegion(
  box,
  videoWidth,
  videoHeight,
  { expand = 24, feather = 12 } = {}
) {
  const user = normalizeBox(box, videoWidth, videoHeight);
  const vw = Math.floor(videoWidth);
  const vh = Math.floor(videoHeight);
  const pad = Math.max(0, Math.round(expand));
  const margin = 1;
  const maxX2 = vw - margin;
  const maxY2 = vh - margin;

  let x1 = Math.max(margin, user.x - pad);
  let y1 = Math.max(margin, user.y - pad);
  let x2 = Math.min(maxX2, user.x + user.width + pad);
  let y2 = Math.min(maxY2, user.y + user.height + pad);

  let x = evenAtLeast(x1, margin);
  let y = evenAtLeast(y1, margin);
  let w = even(x2 - x);
  let h = even(y2 - y);
  if (w < 2) w = 2;
  if (h < 2) h = 2;
  if (x + w > maxX2) w = even(Math.max(2, maxX2 - x));
  if (y + h > maxY2) h = even(Math.max(2, maxY2 - y));
  if (x + w > maxX2) x = evenAtLeast(Math.max(margin, maxX2 - w), margin);
  if (y + h > maxY2) y = evenAtLeast(Math.max(margin, maxY2 - h), margin);

  let mx = user.x - x;
  let my = user.y - y;
  let mw = user.width;
  let mh = user.height;
  if (mx < 0) {
    mw += mx;
    mx = 0;
  }
  if (my < 0) {
    mh += my;
    my = 0;
  }
  mw = Math.min(mw, w - mx);
  mh = Math.min(mh, h - my);
  mw = Math.max(2, even(mw));
  mh = Math.max(2, even(mh));
  mx = Math.max(0, even(mx));
  my = Math.max(0, even(my));
  if (mx + mw > w) mw = even(Math.max(2, w - mx));
  if (my + mh > h) mh = even(Math.max(2, h - my));

  const cap = Math.max(0, Math.round(feather));
  const featherBox = {
    left: Math.min(cap, mx),
    right: Math.min(cap, Math.max(0, w - (mx + mw))),
    top: Math.min(cap, my),
    bottom: Math.min(cap, Math.max(0, h - (my + mh))),
  };

  return {
    crop: { x, y, w, h },
    mask: { x: mx, y: my, w: mw, h: mh },
    feather: featherBox,
  };
}
```

If the centered-box assertion fails because `normalizeBox` even-rounds 200/100/80/40, adjust the expected numbers to whatever `normalizeBox` actually returns (keep expand=24 and feather=12 as the rule). Re-run until the test encodes the real even-rounded geometry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix server -- test/inpaintRegion.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/inpaintRegion.js server/test/inpaintRegion.test.js
git commit -m "Add inpaint crop/mask/feather region math"
```

---

### Task 2: FFmpeg crop, mask, overlay args

**Files:**
- Modify: `server/src/ffmpegArgs.js`
- Modify: `server/test/ffmpegArgs.test.js`

- [ ] **Step 1: Write the failing tests** (append to `server/test/ffmpegArgs.test.js`)

```js
import { describe, it, expect } from "vitest";
import {
  buildDelogoArgs,
  buildCropExtractArgs,
  buildMaskArgs,
  buildOverlayArgs,
  parseFrameRate,
  overlayAlphaExpr,
} from "../src/ffmpegArgs.js";

describe("parseFrameRate", () => {
  it("parses nt/dt and plain numbers", () => {
    expect(parseFrameRate("30/1")).toBe(30);
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("25")).toBe(25);
    expect(parseFrameRate("nope")).toBe(30);
  });
});

describe("buildCropExtractArgs", () => {
  it("crops to a PNG sequence", () => {
    const args = buildCropExtractArgs({
      input: "in.mp4",
      crop: { x: 10, y: 20, w: 100, h: 40 },
      pattern: "work/crop/frame_%06d.png",
    });
    expect(args).toContain("-i");
    expect(args).toContain("in.mp4");
    expect(args.find((a) => String(a).startsWith("crop="))).toBe(
      "crop=100:40:10:20"
    );
    expect(args.at(-1)).toBe("work/crop/frame_%06d.png");
  });
});

describe("buildMaskArgs", () => {
  it("overlays a white rect on black", () => {
    const args = buildMaskArgs({
      crop: { w: 128, h: 88 },
      mask: { x: 24, y: 24, w: 80, h: 40 },
      output: "work/mask.png",
    });
    expect(args.join(" ")).toMatch(/color=c=black:s=128x88/);
    expect(args.join(" ")).toMatch(/color=c=white:s=80x40/);
    expect(args.find((a) => String(a).includes("overlay="))).toMatch(
      /overlay=24:24/
    );
    expect(args.at(-1)).toBe("work/mask.png");
  });
});

describe("buildOverlayArgs", () => {
  it("uses nvenc and aac", () => {
    const args = buildOverlayArgs({
      input: "in.mp4",
      fillPattern: "work/fill/frame_%06d.png",
      output: "out.mp4",
      crop: { x: 176, y: 76, w: 128, h: 88 },
      feather: { left: 12, right: 12, top: 12, bottom: 12 },
      fps: 30,
      encoder: "h264_nvenc",
    });
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("aac");
    expect(args).toContain("-filter_complex");
    expect(args.join(" ")).toMatch(/overlay=176:76/);
    expect(args).toContain("-framerate");
    expect(args).toContain("30");
  });

  it("falls back to libx264", () => {
    const args = buildOverlayArgs({
      input: "in.mp4",
      fillPattern: "work/fill/frame_%06d.png",
      output: "out.mp4",
      crop: { x: 1, y: 1, w: 32, h: 32 },
      feather: { left: 0, right: 12, top: 0, bottom: 12 },
      fps: 30,
      encoder: "libx264",
    });
    expect(args).toContain("libx264");
  });
});

describe("overlayAlphaExpr", () => {
  it("avoids divide-by-zero when a side has no feather", () => {
    const expr = overlayAlphaExpr({ left: 0, right: 12, top: 0, bottom: 8 });
    expect(expr).toMatch(/eq\(0,0\)|FL|255/);
    expect(expr).not.toMatch(/\/0/);
  });
});
```

Keep the existing `buildDelogoArgs` tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix server -- test/ffmpegArgs.test.js`

Expected: FAIL on missing exports.

- [ ] **Step 3: Implement args**

Append to `server/src/ffmpegArgs.js` (do not remove `buildDelogoArgs`):

```js
export function parseFrameRate(text) {
  const t = String(text || "").trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const d = Number(m[2]);
    if (d) return n / d;
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function buildFpsProbeArgs(input) {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=r_frame_rate",
    "-of",
    "csv=p=0",
    input,
  ];
}

export function overlayAlphaExpr(feather) {
  const fl = Math.max(0, Number(feather.left) || 0);
  const fr = Math.max(0, Number(feather.right) || 0);
  const ft = Math.max(0, Number(feather.top) || 0);
  const fb = Math.max(0, Number(feather.bottom) || 0);
  const side = (dist, width) =>
    width <= 0 ? "255" : `min(255,${dist}*255/${width})`;
  return `min(${side("X", fl)},min(${side("W-1-X", fr)},min(${side("Y", ft)},${side("H-1-Y", fb)})))`;
}

function encodeVideoArgs(encoder) {
  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    return ["-c:v", encoder, "-preset", "p4", "-rc", "vbr", "-cq", "19"];
  }
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"];
}

export function buildCropExtractArgs({ input, crop, pattern }) {
  return [
    "-y",
    "-i",
    input,
    "-vf",
    `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,
    "-an",
    pattern,
  ];
}

export function buildMaskArgs({ crop, mask, output }) {
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${crop.w}x${crop.h}:d=1`,
    "-f",
    "lavfi",
    "-i",
    `color=c=white:s=${mask.w}x${mask.h}:d=1`,
    "-filter_complex",
    `overlay=${mask.x}:${mask.y}`,
    "-frames:v",
    "1",
    output,
  ];
}

export function buildOverlayArgs({
  input,
  fillPattern,
  output,
  crop,
  feather,
  fps,
  encoder,
}) {
  const alpha = overlayAlphaExpr(feather);
  const filter = `[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[ov];[0:v][ov]overlay=${crop.x}:${crop.y}:format=auto`;
  const args = [
    "-y",
    "-i",
    input,
    "-framerate",
    String(fps),
    "-i",
    fillPattern,
    "-filter_complex",
    filter,
  ];
  args.push(...encodeVideoArgs(encoder));
  args.push("-c:a", "aac", "-b:a", "192k", output);
  return args;
}
```

If `overlayAlphaExpr` test’s `/\/0/` check is too strict (the `*255/12` is fine), keep the zero-width sides as the literal `255` as written above — that is the real requirement.

- [ ] **Step 4: Run tests**

Run: `npm test --prefix server -- test/ffmpegArgs.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ffmpegArgs.js server/test/ffmpegArgs.test.js
git commit -m "Add FFmpeg crop, mask, and feathered overlay args"
```

---

### Task 3: Python geometry helpers

**Files:**
- Create: `server/inpaint/test_geom.py`
- Create: `server/inpaint/geom.py`

- [ ] **Step 1: Write the failing unittest**

```python
import unittest
from geom import fit_long_side, pad_to_multiple


class GeomTest(unittest.TestCase):
    def test_pad_to_multiple_of_8(self):
        self.assertEqual(pad_to_multiple(720), 720)
        self.assertEqual(pad_to_multiple(721), 728)
        self.assertEqual(pad_to_multiple(1), 8)

    def test_fit_long_side_leaves_small_crops(self):
        self.assertEqual(fit_long_side(128, 88), (128, 88))

    def test_fit_long_side_caps_at_720(self):
        w, h = fit_long_side(1920, 800)
        self.assertEqual(max(w, h), 720)
        self.assertAlmostEqual(w / h, 1920 / 800, places=2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run (from `server/inpaint`): `python -m unittest test_geom.py -v`

Expected: FAIL — `No module named geom` or missing functions.

If `python` is missing, use `py -3 -m unittest test_geom.py -v`.

- [ ] **Step 3: Implement**

`server/inpaint/geom.py`:

```python
def pad_to_multiple(n: int, m: int = 8) -> int:
    n = int(n)
    r = n % m
    return n if r == 0 else n + (m - r)


def fit_long_side(w: int, h: int, max_side: int = 720) -> tuple[int, int]:
    w = max(1, int(w))
    h = max(1, int(h))
    long = max(w, h)
    if long <= max_side:
        return w, h
    scale = max_side / long
    return max(1, round(w * scale)), max(1, round(h * scale))
```

- [ ] **Step 4: Run tests**

Run: `python -m unittest test_geom.py -v` (cwd `server/inpaint`)

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/inpaint/geom.py server/inpaint/test_geom.py
git commit -m "Add LaMa resize/pad helpers"
```

---

### Task 4: Python worker + requirements

**Files:**
- Create: `server/inpaint/requirements.txt`
- Create: `server/inpaint/worker.py`
- Modify: `.gitignore`

`--check` must **not** instantiate `SimpleLama` (that downloads weights and would block API health). It only proves imports + CUDA/CPU. The first real run downloads `big-lama.pt` into `server/inpaint/models/` and sets `LAMA_MODEL`.

- [ ] **Step 1: Gitignore venv and models**

Append to `.gitignore`:

```
server/inpaint/.venv/
server/inpaint/models/
```

- [ ] **Step 2: requirements.txt**

```
simple-lama-inpainting==0.1.2
```

Torch is installed first via the README CUDA line so pip does not replace a CUDA wheel with CPU torch.

- [ ] **Step 3: worker.py**

```python
#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

from geom import fit_long_side, pad_to_multiple

MODEL_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"
HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
MODEL_PATH = MODELS / "big-lama.pt"


def device_name() -> str:
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def cmd_check() -> int:
    try:
        import simple_lama_inpainting  # noqa: F401
        import torch  # noqa: F401
    except Exception as exc:
        print(json.dumps({"ok": False, "device": None, "error": str(exc)}))
        return 1
    print(json.dumps({"ok": True, "device": device_name()}))
    return 0


def ensure_model() -> Path:
    if os.environ.get("LAMA_MODEL") and Path(os.environ["LAMA_MODEL"]).is_file():
        return Path(os.environ["LAMA_MODEL"])
    MODELS.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.is_file():
        import urllib.request

        print("downloading LaMa model", file=sys.stderr, flush=True)
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    os.environ["LAMA_MODEL"] = str(MODEL_PATH)
    return MODEL_PATH


def list_frames(folder: Path) -> list[Path]:
    frames = sorted(folder.glob("frame_*.png"))
    if not frames:
        raise SystemExit(f"no frame_*.png in {folder}")
    return frames


def prepare(image, mask):
    from PIL import Image

    w, h = image.size
    nw, nh = fit_long_side(w, h, 720)
    pw, ph = pad_to_multiple(nw), pad_to_multiple(nh)
    img = image.resize((nw, nh), Image.Resampling.LANCZOS) if (nw, nh) != (w, h) else image
    msk = mask.resize((nw, nh), Image.Resampling.NEAREST) if (nw, nh) != (w, h) else mask
    if (pw, ph) != (nw, nh):
        padded = Image.new("RGB", (pw, ph))
        padded.paste(img, (0, 0))
        mp = Image.new("L", (pw, ph), 0)
        mp.paste(msk, (0, 0))
        img, msk = padded, mp
    return img, msk, (w, h), (nw, nh)


def crop_result(result, orig_size, resized):
    from PIL import Image

    nw, nh = resized
    result = result.crop((0, 0, nw, nh))
    if result.size != orig_size:
        result = result.resize(orig_size, Image.Resampling.LANCZOS)
    return result


def cmd_run(input_dir: Path, mask_path: Path, output_dir: Path) -> int:
    from PIL import Image
    from simple_lama_inpainting import SimpleLama
    import torch

    ensure_model()
    dev = torch.device(device_name())
    lama = SimpleLama(device=dev)
    mask = Image.open(mask_path).convert("L")
    frames = list_frames(input_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    n = len(frames)
    for i, frame in enumerate(frames, 1):
        print(f"frame {i}/{n}", file=sys.stderr, flush=True)
        image = Image.open(frame).convert("RGB")
        if mask.size != image.size:
            mask_fit = mask.resize(image.size, Image.Resampling.NEAREST)
        else:
            mask_fit = mask
        img, msk, orig, resized = prepare(image, mask_fit)
        out = lama(img, msk)
        out = crop_result(out, orig, resized)
        out.save(output_dir / frame.name)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--input-dir")
    p.add_argument("--mask")
    p.add_argument("--output-dir")
    args = p.parse_args(argv)
    if args.check:
        return cmd_check()
    if not (args.input_dir and args.mask and args.output_dir):
        p.error("--input-dir --mask --output-dir required")
    return cmd_run(Path(args.input_dir), Path(args.mask), Path(args.output_dir))


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Smoke `--check` without venv (expect fail JSON or missing import)**

Run: `python server/inpaint/worker.py --check`

Expected until venv exists: non-zero or `ok: false`. After Task 9 setup, `{"ok": true, "device": "cuda"}`. Do not require GPU for this task.

- [ ] **Step 5: Commit**

```bash
git add server/inpaint/worker.py server/inpaint/requirements.txt .gitignore
git commit -m "Add LaMa inpaint worker and ignore venv/models"
```

---

### Task 5: Node inpaint helper (python resolve + progress)

**Files:**
- Create: `server/test/inpaint.test.js`
- Create: `server/src/inpaint.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  parseWorkerFrameLine,
  mapInpaintProgress,
  pythonCandidates,
} from "../src/inpaint.js";

describe("parseWorkerFrameLine", () => {
  it("reads frame i/n", () => {
    expect(parseWorkerFrameLine("frame 3/10")).toEqual({ i: 3, n: 10 });
    expect(parseWorkerFrameLine("noise")).toBeNull();
  });
});

describe("mapInpaintProgress", () => {
  it("maps three phases into 0..1", () => {
    expect(mapInpaintProgress("crop", 0)).toBeCloseTo(0);
    expect(mapInpaintProgress("crop", 1)).toBeCloseTo(0.15);
    expect(mapInpaintProgress("worker", 0)).toBeCloseTo(0.15);
    expect(mapInpaintProgress("worker", 1)).toBeCloseTo(0.8);
    expect(mapInpaintProgress("overlay", 0)).toBeCloseTo(0.8);
    expect(mapInpaintProgress("overlay", 1)).toBeCloseTo(1);
  });
});

describe("pythonCandidates", () => {
  it("prefers INPAINT_PYTHON then venv then python then py -3", () => {
    const root = path.join("C:", "app", "inpaint");
    const list = pythonCandidates(root, {
      INPAINT_PYTHON: "D:\\py.exe",
      venvPython: path.join(root, ".venv", "Scripts", "python.exe"),
    });
    expect(list[0]).toEqual(["D:\\py.exe"]);
    expect(list.some((c) => c[0].includes(".venv"))).toBe(true);
    expect(list.some((c) => c[0] === "python")).toBe(true);
    expect(list.some((c) => c[0] === "py" && c[1] === "-3")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test --prefix server -- test/inpaint.test.js`

Expected: FAIL missing module.

- [ ] **Step 3: Implement `server/src/inpaint.js`**

```js
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const inpaintRoot = path.resolve(__dirname, "../inpaint");
export const workerPath = path.join(inpaintRoot, "worker.py");

export function parseWorkerFrameLine(text) {
  const m = /frame\s+(\d+)\s*\/\s*(\d+)/i.exec(String(text));
  if (!m) return null;
  const i = Number(m[1]);
  const n = Number(m[2]);
  if (!n) return null;
  return { i, n };
}

export function mapInpaintProgress(phase, fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  if (phase === "crop") return 0.15 * f;
  if (phase === "worker") return 0.15 + 0.65 * f;
  if (phase === "overlay") return 0.8 + 0.2 * f;
  return f;
}

export function pythonCandidates(root, opts = {}) {
  const envPython = opts.INPAINT_PYTHON ?? process.env.INPAINT_PYTHON;
  const venvPython =
    opts.venvPython ??
    (process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python"));
  const list = [];
  if (envPython) list.push([envPython]);
  list.push([venvPython]);
  list.push(["python"]);
  list.push(["py", "-3"]);
  return list;
}

function runOnce(cmd, cmdArgs, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, cmdArgs, { windowsHide: true });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, error: e.message });
    });
    proc.on("close", (code) => {
      clearTimeout(t);
      const line = out.trim().split("\n").filter(Boolean).at(-1) || "";
      try {
        const json = JSON.parse(line);
        resolve({
          ok: Boolean(json.ok) && code === 0,
          device: json.device ?? null,
          error: json.error || (code === 0 ? null : err.slice(-200)),
        });
      } catch {
        resolve({
          ok: false,
          device: null,
          error: err.slice(-200) || `exit ${code}`,
        });
      }
    });
  });
}

export async function checkInpaint() {
  if (!fs.existsSync(workerPath)) {
    return { ok: false, device: null, error: "worker.py missing" };
  }
  for (const cand of pythonCandidates(inpaintRoot)) {
    const [cmd, ...pre] = cand;
    if (cmd.includes(".venv") && !fs.existsSync(cmd)) continue;
    const result = await runOnce(
      cmd,
      [...pre, workerPath, "--check"],
      20000
    );
    if (result.ok) {
      return { ...result, python: cand };
    }
  }
  return {
    ok: false,
    device: null,
    python: null,
    error:
      "Inpaint engine not ready. In server/inpaint create a venv, install CUDA torch, pip install -r requirements.txt, then python worker.py --check.",
  };
}

export function spawnWorker({ python, inputDir, mask, outputDir }) {
  const [cmd, ...pre] = python;
  return spawn(
    cmd,
    [
      ...pre,
      workerPath,
      "--input-dir",
      inputDir,
      "--mask",
      mask,
      "--output-dir",
      outputDir,
    ],
    { windowsHide: true }
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --prefix server -- test/inpaint.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/inpaint.js server/test/inpaint.test.js
git commit -m "Add inpaint Python probe and progress mapping"
```

---

### Task 6: Three-phase jobs (no delogo on process)

**Files:**
- Modify: `server/src/jobs.js`
- Create: `server/test/jobsInpaint.test.js`

Keep `checkBinaries`, `pickEncoder`, `probeVideo`, `getJob`, `listPublicJob`. Replace `runFfmpeg` + `createAndStartJob` so process uses crop → worker → overlay.

- [ ] **Step 1: Write cancel / progress tests**

```js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cancelJob,
  createJobState,
  getJob,
} from "../src/jobs.js";

describe("createJobState + cancelJob", () => {
  it("kills the active child and removes the work dir", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "inpaint-"));
    fs.writeFileSync(path.join(workDir, "x.txt"), "n");
    let killed = false;
    const job = createJobState({
      workDir,
      outputPath: path.join(workDir, "out.mp4"),
      status: "running",
    });
    job.proc = {
      kill() {
        killed = true;
      },
    };
    cancelJob(job.id);
    expect(killed).toBe(true);
    expect(getJob(job.id).status).toBe("cancelled");
    expect(fs.existsSync(workDir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test --prefix server -- test/jobsInpaint.test.js`

Expected: FAIL `createJobState` is not exported.

- [ ] **Step 3: Implement job pipeline**

In `server/src/jobs.js`:

- Import `buildCropExtractArgs`, `buildMaskArgs`, `buildOverlayArgs`, `buildFpsProbeArgs`, `parseFrameRate` from `./ffmpegArgs.js`.
- Import `mapInpaintProgress`, `parseWorkerFrameLine`, `spawnWorker` from `./inpaint.js`.
- Import `formatFfmpegError` remains.

Add helpers (same file):

```js
export function createJobState(fields) {
  const id = fields.id || randomUUID();
  const job = {
    id,
    status: "queued",
    progress: 0,
    error: null,
    proc: null,
    encoder: null,
    outputName: null,
    outputPath: null,
    workDir: null,
    ...fields,
  };
  jobs.set(id, job);
  return job;
}

function rmWorkDir(job) {
  if (job.workDir && fs.existsSync(job.workDir)) {
    fs.rmSync(job.workDir, { recursive: true, force: true });
  }
}

function spawnTracked(job, cmd, args) {
  const proc = spawn(cmd, args, { windowsHide: true });
  job.proc = proc;
  return proc;
}

function runFfmpegPhase(job, args, phase) {
  return new Promise((resolve, reject) => {
    const proc = spawnTracked(job, "ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (buf) => {
      const text = buf.toString();
      stderr += text;
      const timeMatch = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(text);
      if (timeMatch && job.duration > 0) {
        const t = parseTimeToSeconds(timeMatch[1]);
        if (t != null) {
          job.progress = Math.min(
            0.99,
            mapInpaintProgress(phase, t / job.duration)
          );
        }
      }
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code, signal) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `ffmpeg killed (${signal})`
            : formatFfmpegError(stderr) || `ffmpeg exited ${code}`
        )
      );
    });
  });
}

function probeFps(inputPath) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", buildFpsProbeArgs(inputPath), {
      windowsHide: true,
    });
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("error", () => resolve(30));
    proc.on("close", () => resolve(parseFrameRate(out)));
  });
}

function runWorkerPhase(job) {
  return new Promise((resolve, reject) => {
    const proc = spawnWorker({
      python: job.python,
      inputDir: path.join(job.workDir, "crop"),
      mask: path.join(job.workDir, "mask.png"),
      outputDir: path.join(job.workDir, "fill"),
    });
    job.proc = proc;
    let err = "";
    proc.stderr.on("data", (buf) => {
      const text = buf.toString();
      err += text;
      for (const line of text.split(/\r?\n/)) {
        const parsed = parseWorkerFrameLine(line);
        if (parsed) {
          job.progress = mapInpaintProgress("worker", parsed.i / parsed.n);
        }
      }
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code, signal) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `inpaint killed (${signal})`
            : err.trim().slice(-400) || `inpaint exited ${code}`
        )
      );
    });
  });
}
```

Replace `createAndStartJob`:

```js
export function createAndStartJob({
  inputPath,
  region,
  duration,
  preferredEncoder,
  python,
}) {
  const id = randomUUID();
  const outputName = `${id}.mp4`;
  const outputPath = path.join(outputsDir, outputName);
  const workDir = path.join(outputsDir, `inpaint-${id}`);
  const job = createJobState({
    id,
    inputPath,
    outputPath,
    outputName,
    region,
    duration: duration || 0,
    encoder: preferredEncoder,
    python,
    workDir,
  });

  (async () => {
    job.status = "running";
    try {
      fs.mkdirSync(path.join(workDir, "crop"), { recursive: true });
      fs.mkdirSync(path.join(workDir, "fill"), { recursive: true });
      const fps = await probeFps(inputPath);
      job.fps = fps;

      await runFfmpegPhase(
        job,
        buildMaskArgs({
          crop: region.crop,
          mask: region.mask,
          output: path.join(workDir, "mask.png"),
        }),
        "crop"
      );
      await runFfmpegPhase(
        job,
        buildCropExtractArgs({
          input: inputPath,
          crop: region.crop,
          pattern: path.join(workDir, "crop", "frame_%06d.png"),
        }),
        "crop"
      );
      await runWorkerPhase(job);

      const overlayOnce = (encoder) =>
        runFfmpegPhase(
          job,
          buildOverlayArgs({
            input: inputPath,
            fillPattern: path.join(workDir, "fill", "frame_%06d.png"),
            output: outputPath,
            crop: region.crop,
            feather: region.feather,
            fps,
            encoder,
          }),
          "overlay"
        );

      try {
        await overlayOnce(preferredEncoder);
        job.encoder = preferredEncoder;
      } catch (err) {
        if (
          preferredEncoder !== "libx264" &&
          job.status !== "cancelled" &&
          fs.existsSync(inputPath)
        ) {
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch {
              /* ignore */
            }
          }
          await overlayOnce("libx264");
          job.encoder = "libx264";
        } else {
          throw err;
        }
      }

      if (job.status !== "cancelled") {
        job.status = "done";
        job.progress = 1;
      }
    } catch (err) {
      if (job.status === "cancelled") return;
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          /* ignore */
        }
      }
    } finally {
      if (job.status !== "running") {
        rmWorkDir(job);
      }
    }
  })();

  return job;
}
```

Update `cancelJob` to also `rmWorkDir(job)` after killing `job.proc` (keep deleting `outputPath` as today).

Remove the old `runFfmpeg` that called `buildDelogoArgs`, or leave it unused — prefer delete to avoid a dead delogo path on jobs.

- [ ] **Step 4: Run tests**

Run: `npm test --prefix server -- test/jobsInpaint.test.js test/ffmpegArgs.test.js test/inpaint.test.js`

Expected: PASS. Then `npm test --prefix server` — fix anything broken by the `createAndStartJob` signature change (only `index.js` calls it; tests may not).

- [ ] **Step 5: Commit**

```bash
git add server/src/jobs.js server/test/jobsInpaint.test.js
git commit -m "Run watermark jobs as crop, LaMa, overlay"
```

---

### Task 7: API health + process gate

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Wire health and process** (no HTTP test harness in this repo; unit-test the 503 message helper if you extract it, otherwise implement and rely on health shape + existing vitest suite).

In `server/src/index.js`:

- Import `checkInpaint` from `./inpaint.js` and `fitInpaintRegion` from `./inpaintRegion.js`. Remove process-route use of `fitDelogoRegion`.
- `let cachedInpaint = { ok: false, device: null, error: null, python: null };`
- In `refreshEnv()`, after encoder pick: `cachedInpaint = await checkInpaint();`
- Health:

```js
app.get("/api/health", async () => ({
  ok: binaries.ffmpeg && binaries.ffprobe,
  ffmpeg: binaries.ffmpeg,
  ffprobe: binaries.ffprobe,
  ytdlp: Boolean(binaries.ytdlp),
  encoder: cachedEncoder,
  inpaint: {
    ok: Boolean(cachedInpaint.ok),
    device: cachedInpaint.device,
    error: cachedInpaint.ok ? null : cachedInpaint.error,
  },
}));
```

- `POST /api/process`: if `!cachedInpaint.ok`, `503` with `{ error: cachedInpaint.error }`. Else `fitInpaintRegion(box, upload.width, upload.height)` and `createAndStartJob({ inputPath, region, duration, preferredEncoder: cachedEncoder, python: cachedInpaint.python })`. Return `{ jobId, region }` (client currently ignores extra fields).

- [ ] **Step 2: Run server tests**

Run: `npm test --prefix server`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "Gate watermark process on inpaint health"
```

---

### Task 8: Watermark UI banner and button

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/src/pages/WatermarkPage.tsx`
- Modify: `client/src/components/VideoWorkspace.tsx`

- [ ] **Step 1: Extend Health**

In `client/src/api.ts`:

```ts
export type Health = {
  ok: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp?: boolean;
  encoder: string;
  inpaint?: {
    ok: boolean;
    device: "cuda" | "cpu" | null;
    error?: string | null;
  };
};
```

- [ ] **Step 2: WatermarkPage banners**

Keep the FFmpeg banners. Add:

- If `health.ok && health.inpaint?.ok && health.inpaint.device === "cuda"`: banner ok `KI bereit · CUDA`
- If `health.ok && health.inpaint?.ok && health.inpaint.device === "cpu"`: banner ok `KI bereit · CPU (langsam)`
- If `health.ok && !health.inpaint?.ok`: banner danger with `health.inpaint?.error` or the README pip sentence.

Pass `inpaintReady={Boolean(health?.inpaint?.ok)}` into `VideoWorkspace`.

- [ ] **Step 3: Disable Remove watermark unless inpaintReady**

In `VideoWorkspace`, add prop `inpaintReady: boolean`. Include `!inpaintReady` in the primary button `disabled` condition (together with existing `ready` / box / upload checks).

- [ ] **Step 4: Typecheck if you have it; otherwise visually confirm the files compile**

Run: `npm test --prefix server`

Client has no unit tests; do not add a framework.

- [ ] **Step 5: Commit**

```bash
git add client/src/api.ts client/src/pages/WatermarkPage.tsx client/src/components/VideoWorkspace.tsx
git commit -m "Show inpaint engine status on the Watermark tab"
```

---

### Task 9: README setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an Inpaint section after Requirements**

Requirements bullet: Python 3.10+ (3.11/3.12 preferred).

New section:

```markdown
## Inpaint engine (Watermark tab)

delogo is no longer used. The Watermark tab needs a local LaMa worker:

```powershell
cd server/inpaint
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
python worker.py --check
```

`--check` should print `"device": "cuda"` on the RTX 5070 Ti. If it says `cpu`, the CUDA torch wheel did not install — fix that before processing long clips.

Restart `npm run dev` after a successful check. The first **Remove watermark** run downloads `big-lama.pt` into `server/inpaint/models/` (~200 MB, once).
```

If cu128 is wrong for the installed torch index at implementation time, use the current extra index from https://pytorch.org/get-started/locally/ (Windows, pip, CUDA). Do not invent a CUDA version that pip rejects.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document local LaMa setup for watermark removal"
```

---

### Task 10: Verify end-to-end on this machine

- [ ] **Step 1: Install the venv as in README and run `--check`**

Expected: `{"ok": true, "device": "cuda"}`

- [ ] **Step 2: `npm test --prefix server` and `python -m unittest test_geom.py` from `server/inpaint`**

Expected: all PASS

- [ ] **Step 3: `npm run dev`, open Watermark, confirm banner `KI bereit · CUDA`**

- [ ] **Step 4: Process a short clip with a corner logo**

Expected: job completes; audio present; patch is not a delogo smear. Large overlays may still look reconstructed.

- [ ] **Step 5: Stop the venv / hide python and restart API**

Expected: process button disabled; 503 text if something still calls the API; no delogo output file.

---

## Self-review (spec coverage)

| Spec item | Task |
|-----------|------|
| LaMa on box crop + feather overlay | 1, 2, 4, 6 |
| Same one-button UI | 8 |
| No silent delogo | 6, 7, 8 |
| CUDA / CPU banner | 7, 8 |
| PNG sequence I/O | 2, 4, 6 |
| Long side 720 + pad 8 | 3, 4 |
| Health `inpaint` | 5, 7 |
| 503 + README setup | 7, 9 |
| Cancel kills child + temps | 6 |
| NVENC then libx264 | 2, 6 |
| Tests without GPU | 1–3, 5–6 |
| Models gitignored | 4 |
| 4K / 1080×1920 region cases | 1 |
