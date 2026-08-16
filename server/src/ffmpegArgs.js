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
