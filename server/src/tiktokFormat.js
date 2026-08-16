export function buildTiktokFormatArgs({ input, output, encoder }) {
  const vf =
    "scale=1080:1920:force_original_aspect_ratio=increase," +
    "crop=1080:1920,setsar=1";

  const args = ["-y", "-i", input, "-vf", vf];

  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    args.push(
      "-c:v",
      encoder,
      "-preset",
      "p5",
      "-rc",
      "vbr",
      "-cq",
      "18",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p"
    );
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "17",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p"
    );
  }

  args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output);
  return args;
}
