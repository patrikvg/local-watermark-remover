const MIN = 16;

function even(n) {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v - 1;
}

export function normalizeBox(box, videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight) throw new Error("Invalid video size");
  let x = Math.max(0, Math.min(box.x, videoWidth - 1));
  let y = Math.max(0, Math.min(box.y, videoHeight - 1));
  let width = Math.max(MIN, box.width);
  let height = Math.max(MIN, box.height);
  if (x + width > videoWidth) width = videoWidth - x;
  if (y + height > videoHeight) height = videoHeight - y;
  width = Math.max(MIN, Math.min(width, videoWidth));
  height = Math.max(MIN, Math.min(height, videoHeight));
  if (x + width > videoWidth) x = Math.max(0, videoWidth - width);
  if (y + height > videoHeight) y = Math.max(0, videoHeight - height);
  return {
    x: even(x),
    y: even(y),
    width: even(Math.max(MIN, width)),
    height: even(Math.max(MIN, height)),
  };
}

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
