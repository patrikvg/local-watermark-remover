/** Keep in sync with server/src/rankingTimeline.js and server/src/textWrap.js */

export const CANVAS = { width: 1080, height: 1920 };
export const RANK_FONT = 120;
export const RANK_LINE_HEIGHT = 140;
export const TITLE_FONT = 64;
export const TITLE_LINE_SPACING = 8;
export const TITLE_MIN_W = 48;
export const CAPTION_LINE_SPACING = 8;
export const CAPTION_X_RATIO = 0.85;
export const CHAR_WIDTH_RATIO = 0.52;

/** Preview px → 1080×1920 using the same scale as overlay fonts (width). */
export function toCanvasPos(
  pos: { x: number; y: number },
  stageW: number
) {
  const s = CANVAS.width / Math.max(1, stageW);
  return {
    x: Math.round(pos.x * s),
    y: Math.round(pos.y * s),
  };
}

export function toCanvasLen(n: number, stageW: number) {
  return Math.round((n / Math.max(1, stageW)) * CANVAS.width);
}

export function captionFontSize(rankFontSize = RANK_FONT) {
  return Math.max(28, Math.round(rankFontSize * 0.35));
}

export function wrapOverlayText(
  text: string,
  maxWidth: number,
  fontSize: number,
  wrap = true
) {
  const src = String(text ?? "").replace(/\r/g, "");
  if (!wrap) {
    return src.replace(/\n+/g, " ").replace(/[ \t]+/g, " ").trim();
  }

  const charW = Math.max(1, Number(fontSize) * CHAR_WIDTH_RATIO);
  const limit = Math.max(charW, Number(maxWidth) || 0);
  const paragraphs = src.split("\n");
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const trial = `${current} ${words[i]}`;
      if (trial.length * charW <= limit) {
        current = trial;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }

  return lines.join("\n");
}

export function overlayTextHeight(
  text: string,
  fontSize: number,
  lineSpacing = 8
) {
  const lines = Math.max(1, String(text ?? "").split("\n").length);
  return lines * fontSize + Math.max(0, lines - 1) * lineSpacing;
}

export function centerAlong(
  rankY: number,
  rankFontSize: number,
  textHeight: number
) {
  return rankY + Math.round((rankFontSize - textHeight) / 2);
}

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
  const lines = Math.max(1, String(display).split("\n").length);
  const heightCanvas = lines * (TITLE_FONT + TITLE_LINE_SPACING);
  const estimatedPreviewW =
    String(display).length * TITLE_FONT * CHAR_WIDTH_RATIO * s;
  const width = wrap
    ? boxWidthPreview
    : Math.max(TITLE_MIN_W, estimatedPreviewW);
  return {
    width,
    height: heightCanvas * s,
  };
}
