export function buildDelogoFilter(d) {
  return `delogo=x=${d.x}:y=${d.y}:w=${d.w}:h=${d.h}:show=0`;
}

export function buildDelogoArgs({ input, output, delogo, encoder }) {
  const vf = buildDelogoFilter(delogo);
  const args = ["-y", "-i", input, "-vf", vf];

  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    args.push("-c:v", encoder, "-preset", "p4", "-rc", "vbr", "-cq", "19");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18");
  }

  // Re-encode audio so MKV/Opus/AV1 sources mux cleanly into MP4.
  args.push("-c:a", "aac", "-b:a", "192k", output);
  return args;
}

export function buildProbeArgs(input) {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,duration",
    "-of",
    "json",
    input,
  ];
}

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
