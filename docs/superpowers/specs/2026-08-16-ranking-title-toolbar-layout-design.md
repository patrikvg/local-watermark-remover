# Ranking Editor — Viblo-like Title Toolbar & Layout — Design Spec

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Project:** `C:\Users\patrodev\watermark-remover` (Ranking module UI + export styles)

## Goal

Restructure the Ranking editor closer to a Viblo-style layout (title tools on top, clips/settings below, sticky 9:16 preview) and add a **title toolbar**: font family, size, color, stroke width, bold/regular, and text alignment — live in preview and burned into export.

Keep the **existing app visual theme** (not Viblo’s light/card chrome). Not a 1:1 clone.

## Product decisions

| Decision | Choice |
|----------|--------|
| Scope band | **B** — Title toolbar + clearer section layout; no Video Height %, Background color, master Caption toggle, emoji, undo/redo |
| Title controls | Font, size, color, stroke width, bold/regular, align left/center/right |
| Stroke color | Black (unchanged from current export) |
| Italic | Out of scope |
| Font list | Fixed Windows-friendly set: **Arial, Impact, Segoe UI, Georgia, Consolas** |
| Missing font file | Fall back to Arial Bold (`arialbd.ttf`) |
| Visual theme | Existing app style; Viblo-like **structure** only |
| Preview chrome | Keep in-video transport, magnetic snap, **Mitte** button |
| Clip / audio / ranks | Behavior unchanged |

## Layout

```
┌────────────────────────────────┬─────────────────┐
│ Title section                  │ Preview (9:16)  │
│  [font][size][B][align][color] │ sticky          │
│  [textarea]  [stroke slider]   │ + transport overlay│
│  [wrap] [Mitte]                │                 │
│ Clips section                  │                 │
│ Audio section                  │                 │
│ Export actions                 │                 │
└────────────────────────────────┴─────────────────┘
```

- Left column: stacked sections with clear headings.
- Right column: existing sticky preview.
- No light “card” redesign; tighten spacing and add a compact toolbar row.

## Title style model

New client state (in addition to existing `title`, `titlePos`, `titleWidth`, `titleWrap`, `titleBorder`):

| Field | Type | Notes |
|-------|------|--------|
| `titleFont` | enum | `arial` \| `impact` \| `segoe` \| `georgia` \| `consolas` |
| `titleSize` | number | Canvas-space font size (export pixels); preview scales with stage |
| `titleWeight` | `regular` \| `bold` | Maps to regular vs bold TTF |
| `titleColor` | string | `#rrggbb` |
| `titleAlign` | `left` \| `center` \| `right` | CSS `text-align` in overlay box; export positions lines accordingly |

Defaults: Arial, size ≈ current `TITLE_FONT` (64), bold, `#ffffff`, align left (or center if product prefers — **default left** to match today’s left-anchored box).

### Preview

- `TitleOverlay` applies `font-family`, `font-weight`, `font-size` (scaled), `color`, `text-align`, existing stroke via `-webkit-text-stroke` / paint order as today.
- Drag, wrap width handle, magnetic X snap, and **Mitte** keep working with the styled box.

### Export

- Extend ranking export payload + job with the new fields.
- `rankingFfmpeg.js` `titleDrawtext` uses mapped `fontfile`, `fontsize=titleSize`, `fontcolor=titleColor`, `borderw=titleBorder`.
- Alignment: for multi-line titles, each line’s drawtext `x` accounts for `titleAlign` within `titleWidth` (left = `titlePos.x`; center/right use text width / box width). Exact formula documented in the implementation plan; preview and export must use the same box model.

### Font file map (Windows)

| Key | Regular | Bold |
|-----|---------|------|
| arial | `C:/Windows/Fonts/arial.ttf` | `arialbd.ttf` |
| impact | `impact.ttf` | `impact.ttf` (no separate bold → same file) |
| segoe | `segoeui.ttf` | `segoeuib.ttf` |
| georgia | `georgia.ttf` | `georgiab.ttf` |
| consolas | `consola.ttf` | `consolab.ttf` |

Escape paths for FFmpeg as today. If the chosen file is missing at export time, use `arialbd.ttf`.

## Files (expected)

| Path | Role |
|------|------|
| `client/src/components/ranking/TitleControls.tsx` | Toolbar UI |
| `client/src/pages/RankingPage.tsx` | Section layout + state wiring |
| `client/src/components/ranking/TitleOverlay.tsx` | Live styles |
| `client/src/rankingLayout.ts` | Size scaling / shared constants |
| `client/src/styles.css` | Toolbar + section layout |
| `client/src/api.ts` | Export fields |
| `server/src/rankingFfmpeg.js` | drawtext styles + font map |
| `server/src/rankingJobs.js` / `index.js` | Pass-through validation |
| `server/test/rankingFfmpeg.test.js` | Assert fontcolor/fontsize/fontfile / fallback |

Shared font-id → CSS family + file paths can live in a small module duplicated or mirrored client/server (same keys).

## Out of scope

- Video height %, canvas background color, enable-caption master toggle  
- Emoji picker, undo/redo, rich contentEditable  
- Italic, custom uploaded fonts, stroke color picker  
- Full Viblo light theme / sidebar clone  
- Changing rank digit fonts (remain Arial Bold unless later requested)

## Success criteria

1. Ranking page reads as Title → Clips → Audio | Preview, in existing theme.  
2. Changing font/size/color/weight/align updates the preview title immediately.  
3. Export video matches those styles (within FFmpeg/drawtext limits and font availability).  
4. Missing font files fall back to Arial Bold without crashing the job.  
5. Existing snap, Mitte, wrap, in-video player, and clip/rank behavior still work.

## Testing

- Unit: font map resolves expected paths; fallback when bold file absent for Impact.  
- Unit: title drawtext filter includes fontsize, fontcolor, fontfile for a sample payload.  
- Manual: toolbar combinations in preview; one export smoke with non-default font/color/align.
