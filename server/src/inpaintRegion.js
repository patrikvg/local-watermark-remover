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
