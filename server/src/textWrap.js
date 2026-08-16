/** Approximate Arial Bold advance width as a fraction of font size. */
export const CHAR_WIDTH_RATIO = 0.52;

/**
 * Wrap overlay text to a pixel box. Manual newlines are kept when wrap is on.
 * When wrap is off, everything becomes one line (a “sausage”).
 */
export function wrapOverlayText(text, maxWidth, fontSize, wrap = true) {
  const src = String(text ?? "").replace(/\r/g, "");
  if (!wrap) {
    return src.replace(/\n+/g, " ").replace(/[ \t]+/g, " ").trim();
  }

  const charW = Math.max(1, Number(fontSize) * CHAR_WIDTH_RATIO);
  const limit = Math.max(charW, Number(maxWidth) || 0);
  const paragraphs = src.split("\n");
  const lines = [];

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

export function overlayTextHeight(text, fontSize, lineSpacing = 8) {
  const lines = Math.max(1, String(text ?? "").split("\n").length);
  return lines * fontSize + Math.max(0, lines - 1) * lineSpacing;
}

export function centerAlong(rankY, rankFontSize, textHeight) {
  return rankY + Math.round((rankFontSize - textHeight) / 2);
}
