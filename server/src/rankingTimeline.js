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

/**
 * Visual stack: rank 1 at top, rank 5 at bottom.
 * Playback order stays 5 → 1 (countdown); when 5 appears first it sits at the bottom.
 */
export function stackPositions({
  leftPad = 48,
  topPad = 220,
  lineHeight = 140,
  fontSize = 120,
  originX = 0,
  originY = 0,
} = {}) {
  /** @type {Record<number, {x:number,y:number,fontSize:number}>} */
  const out = {};
  for (let rank = 1; rank <= 5; rank++) {
    const stackIndex = rank - 1; // 1 -> 0 (top), 5 -> 4 (bottom)
    out[rank] = {
      x: leftPad + originX,
      y: topPad + originY + stackIndex * lineHeight,
      fontSize,
    };
  }
  return out;
}

export const ANIM_SECONDS = 0.45;
export const CANVAS = { width: 1080, height: 1920 };
