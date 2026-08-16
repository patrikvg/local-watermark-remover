# Ranking Preview — In-Video Player & Title Snap — Design Spec

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Project:** `C:\Users\patrodev\watermark-remover` (Ranking module UI polish)

## Goal

Make the Ranking **9:16 preview** feel closer to a normal video player and make horizontal title centering easy:

1. Move transport controls **into** the preview stage (YouTube-style overlay that hides on idle).
2. Add **magnetic horizontal snap** while dragging the title, plus a **Center** button for exact centering (X always; Y only via the button).

Export / FFmpeg behavior is unchanged — this is preview/editor UX only.

## Product decisions

| Decision | Choice |
|----------|--------|
| Control placement | Overlay at the bottom **inside** `.ranking-stage` |
| Idle behavior | Hide after ~2s idle; show again on hover / pointer move / tap |
| Click-to-play | Click on video area (not overlays) toggles play/pause |
| Clip status hint | Keep as non-exported UI chrome (under stage or subtle in overlay) |
| Title snap while drag | Horizontal only; magnetic when near stage center (±~8px) |
| Snap guide | Vertical center guide line visible while near snap |
| Center button | Always sets exact horizontal center; also sets vertical center |
| Rank stack | No snap (out of scope) |
| Server / export | No changes |

## Architecture

Reuse existing client pieces; no new packages.

```
RankingPage
  ├─ Title field + wrap/border + [Mitte] button
  └─ RankingPreview
       ├─ ranking-stage
       │    ├─ <video>
       │    ├─ rank stack overlay
       │    ├─ TitleOverlay (drag + magnetic X snap + guide)
       │    └─ transport overlay (play / seek / time)
       └─ optional clip hint outside stage
```

Helpers for center math live in `rankingLayout.ts` (or a tiny local helper) so preview and button share the same formula:

- `centerTitleX(stageWidth, boxWidth) = (stageWidth - boxWidth) / 2`
- `centerTitleY(stageHeight, boxHeight) = (stageHeight - boxHeight) / 2` (button only; box height from rendered title)

## In-video player

### Behavior

- Relocate the existing play/pause, seek range, and time readout from `.ranking-transport` into an absolute overlay at the bottom of `.ranking-stage`.
- Gradient behind controls for readability over bright frames.
- Idle timer (~2s) without pointer activity over the stage → add a CSS class that fades/hides the overlay.
- Pointer enter / move / down on the stage resets the idle timer and shows controls.
- While scrubbing the seek bar, keep controls visible.
- Pointer down on the video surface (not title, ranks, handles, or transport) toggles play/pause when clips are playable.
- Existing multi-clip seek / `pendingSeek` / volume logic stays as-is.

### Visual

- Compact YouTube-like bar: play button, flexible seek track, `m:ss / m:ss`.
- z-index above video, below or coordinated with title/ranks so dragging overlays still works; transport should not block title drag (title remains higher z-index where they overlap, or transport reserves bottom strip).

## Title snap

### Magnetic drag (horizontal)

- On title `pointermove` while dragging: compute target `x`; if `|x - centerX| <= SNAP_THRESHOLD` (≈8 CSS px), set `x = centerX`.
- Show a vertical guide at `stageWidth / 2` only while magnetically snapped (or while within threshold).
- On pointer up, keep the last `x`/`y` (snapped or free). No auto vertical snap on release.

### Center button

- Placed near existing title controls on `RankingPage`.
- On click:
  1. Set `titlePos.x` to exact horizontal center for current `titleWidth` (or measured nowrap width if wrap is off).
  2. Set `titlePos.y` to exact vertical center for the current rendered title box height.
- Uses live stage size from `stageSizeRef` / preview-reported dimensions so preview and export scale stay consistent with existing `toCanvasPos` flow.

### Resize interaction

- Widening/narrowing the title box updates what “center” means; magnetic snap and the button always use current width/height.

## Files to touch

| File | Change |
|------|--------|
| `client/src/components/ranking/RankingPreview.tsx` | Move transport into stage; idle show/hide; click-to-toggle play |
| `client/src/components/ranking/TitleOverlay.tsx` | Magnetic X snap + center guide; accept stage size / snap helpers |
| `client/src/pages/RankingPage.tsx` | Center button wiring |
| `client/src/rankingLayout.ts` | Shared center helpers (optional but preferred) |
| `client/src/styles.css` | Overlay transport, idle fade, snap guide |

## Out of scope

- Snap for rank stack / captions
- Native `<video controls>`
- Volume / mute controls inside the overlay
- Changing burned-in export title position format or server APIs
- Full YouTube chrome (settings, fullscreen, quality, etc.)

## Testing

- Manual: idle hide/show, seek while hidden-then-shown, click play vs drag title, snap near center, Center button X+Y.
- Optional unit: `centerTitleX` / `centerTitleY` with a few widths/heights.
- No new FFmpeg tests required.

## Success criteria

1. With all 5 clips loaded, transport appears inside the 9:16 frame and hides after idle like a typical web video player.
2. Dragging the title near horizontal center snaps and shows a guide; releasing far from center does not force center.
3. **Mitte** places the title exactly in the horizontal and vertical middle of the stage for the current box size.
4. Export still uses the same `titlePos` / width pipeline with no backend changes.
