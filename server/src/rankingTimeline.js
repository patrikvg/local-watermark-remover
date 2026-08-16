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

export function stackPositions({
  leftPad = 48,
  topPad = 220,
  lineHeight = 140,
  fontSize = 120,
}) {
  /** @type {Record<number, {x:number,y:number,fontSize:number}>} */
  const out = {};
  for (let rank = 5; rank >= 1; rank--) {
    const stackIndex = 5 - rank; // 5 -> 0, 1 -> 4
    out[rank] = {
      x: leftPad,
      y: topPad + stackIndex * lineHeight,
      fontSize,
    };
  }
  return out;
}

export const ANIM_SECONDS = 0.45;
export const CANVAS = { width: 1080, height: 1920 };
