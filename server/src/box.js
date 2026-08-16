const MIN = 16;

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
 * Clamp a user box into the coded video frame.
 * Guarantees x/y/width/height are even and fully inside the frame.
 */
export function normalizeBox(box, videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight) throw new Error("Invalid video size");
  const vw = Math.floor(videoWidth);
  const vh = Math.floor(videoHeight);

  let width = Math.max(MIN, Number(box.width) || 0);
  let height = Math.max(MIN, Number(box.height) || 0);
  width = Math.min(width, vw);
  height = Math.min(height, vh);

  let x = Number(box.x) || 0;
  let y = Number(box.y) || 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Invalid box coordinates");
  }

  if (x + width > vw) x = vw - width;
  if (y + height > vh) y = vh - height;
  x = Math.max(0, x);
  y = Math.max(0, y);

  x = even(x);
  y = even(y);
  width = evenAtLeast(width, Math.min(MIN, vw));
  height = evenAtLeast(height, Math.min(MIN, vh));

  if (x + width > vw) {
    width = evenAtLeast(vw - x, 2);
    if (x + width > vw) x = even(Math.max(0, vw - width));
  }
  if (y + height > vh) {
    height = evenAtLeast(vh - y, 2);
    if (y + height > vh) y = even(Math.max(0, vh - height));
  }

  if (width < 2 || height < 2 || x < 0 || y < 0 || x + width > vw || y + height > vh) {
    throw new Error("Box does not fit inside the video frame");
  }

  return { x, y, width, height };
}

/**
 * Expand a normalized box for softer edges, then clamp so delogo never
 * leaves the frame (critical for bottom-right / edge watermarks).
 *
 * FFmpeg delogo requires a 1px margin: x>=1, y>=1, x+w<=W-1, y+h<=H-1.
 */
export function fitDelogoRegion(box, videoWidth, videoHeight, expand = 8) {
  const normalized = normalizeBox(box, videoWidth, videoHeight);
  const vw = Math.floor(videoWidth);
  const vh = Math.floor(videoHeight);
  const pad = Math.max(0, Math.round(expand));
  const margin = 1; // delogo samples neighbors outside the rect
  const maxX2 = vw - margin;
  const maxY2 = vh - margin;
  const minX1 = margin;
  const minY1 = margin;

  let x1 = Math.max(minX1, normalized.x - pad);
  let y1 = Math.max(minY1, normalized.y - pad);
  let x2 = Math.min(maxX2, normalized.x + normalized.width + pad);
  let y2 = Math.min(maxY2, normalized.y + normalized.height + pad);

  // If expand pushed against an edge, shrink from the opposite side instead.
  if (x2 - x1 < 2) {
    x1 = minX1;
    x2 = Math.min(maxX2, x1 + Math.max(2, normalized.width));
  }
  if (y2 - y1 < 2) {
    y1 = minY1;
    y2 = Math.min(maxY2, y1 + Math.max(2, normalized.height));
  }

  let x = evenAtLeast(x1, margin);
  let y = evenAtLeast(y1, margin);
  // Keep even sizes but stay strictly inside margin.
  let w = even(x2 - x);
  let h = even(y2 - y);
  if (w < 2) w = 2;
  if (h < 2) h = 2;
  if (x + w > maxX2) w = even(Math.max(2, maxX2 - x));
  if (y + h > maxY2) h = even(Math.max(2, maxY2 - y));
  if (x + w > maxX2) x = evenAtLeast(Math.max(minX1, maxX2 - w), margin);
  if (y + h > maxY2) y = evenAtLeast(Math.max(minY1, maxY2 - h), margin);

  if (
    w < 2 ||
    h < 2 ||
    x < margin ||
    y < margin ||
    x + w > vw - margin ||
    y + h > vh - margin
  ) {
    throw new Error("Watermark region is outside the video frame");
  }

  return { x, y, w, h, show: 0 };
}

/** @deprecated use fitDelogoRegion — kept for older tests/call sites */
export function toDelogoParams(box, expand = 8) {
  const pad = Math.max(0, Math.round(expand));
  return {
    x: even(Math.max(0, box.x - pad)),
    y: even(Math.max(0, box.y - pad)),
    w: even(box.width + pad * 2),
    h: even(box.height + pad * 2),
    show: 0,
  };
}

export function scaleBoxFromDisplay(
  box,
  displayWidth,
  displayHeight,
  videoWidth,
  videoHeight
) {
  if (!displayWidth || !displayHeight) {
    throw new Error("Invalid display size for box scaling");
  }
  const sx = videoWidth / displayWidth;
  const sy = videoHeight / displayHeight;
  return normalizeBox(
    {
      x: box.x * sx,
      y: box.y * sy,
      width: box.width * sx,
      height: box.height * sy,
    },
    videoWidth,
    videoHeight
  );
}

export function formatFfmpegError(stderrOrMessage) {
  const text = String(stderrOrMessage || "");
  if (/Logo area is outside of the frame/i.test(text)) {
    return "Watermark box is outside the video frame. Redraw the box on the picture (not on black bars) and try again.";
  }
  if (/Option not found/i.test(text) && /delogo/i.test(text)) {
    return "This FFmpeg build rejected a delogo option. Update FFmpeg or restart the app.";
  }
  if (/Conversion failed/i.test(text) || /Invalid argument/i.test(text)) {
    const tail = text.replace(/\r/g, "").trim().split("\n").slice(-4).join(" ");
    return `Processing failed (${tail.slice(0, 240)})`;
  }
  return text.slice(-500) || "Processing failed";
}
