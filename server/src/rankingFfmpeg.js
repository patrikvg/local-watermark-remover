import {
  ANIM_SECONDS,
  CANVAS,
  buildSegments,
  stackPositions,
} from "./rankingTimeline.js";

export function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function fontfileOption() {
  if (process.platform === "win32") {
    // Quoted path so drive-letter ":" survives filter parsing under spawn().
    return "fontfile='C\\:/Windows/Fonts/arialbd.ttf':";
  }
  return "";
}

function videoChain(i) {
  const { width, height } = CANVAS;
  return (
    `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${i}]`
  );
}

function audioChain(i, muteClips, duration) {
  if (muteClips) {
    return (
      `anullsrc=channel_layout=stereo:sample_rate=44100,` +
      `atrim=0:${duration},asetpts=PTS-STARTPTS[a${i}]`
    );
  }
  return `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
    `asetpts=PTS-STARTPTS[a${i}]`;
}

function rankDrawtext({ rank, start, x, y, fontSize }) {
  const anim = ANIM_SECONDS;
  const font = fontfileOption();
  return (
    `drawtext=${font}text=${rank}:` +
    `fontsize=${fontSize}:fontcolor=white:borderw=4:bordercolor=black:` +
    `x='if(lt(t-${start}\\,${anim})\\,-tw+(t-${start})/${anim}*(${x}+tw)\\,${x})':` +
    `y=${y}:enable='gte(t\\,${start})'`
  );
}

function titleDrawtext({ title, x, y }) {
  const font = fontfileOption();
  const escaped = escapeDrawtext(title);
  return (
    `drawtext=${font}text='${escaped}':` +
    `fontsize=72:fontcolor=white:borderw=3:bordercolor=black:` +
    `x=${x}:y=${y}`
  );
}

/**
 * @param {{
 *   clips: string[],
 *   durations: number[],
 *   title: string,
 *   titlePos: { x: number, y: number },
 *   muteClips: boolean,
 *   bgmPath: string | null,
 *   bgmVolume: number,
 *   encoder: string,
 *   output: string,
 * }} opts
 */
export function buildRankingArgs({
  clips,
  durations,
  title,
  titlePos,
  muteClips,
  bgmPath,
  bgmVolume,
  encoder,
  output,
}) {
  if (!Array.isArray(clips) || clips.length !== 5) {
    throw new Error("Exactly 5 clips required");
  }
  if (muteClips && !bgmPath) {
    throw new Error("Background music is required when clips are muted");
  }

  const segments = buildSegments(durations);
  const positions = stackPositions({});
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  const filters = [];

  for (let i = 0; i < 5; i++) {
    filters.push(videoChain(i));
    filters.push(audioChain(i, muteClips, durations[i]));
  }

  const concatInputs = [0, 1, 2, 3, 4].map((i) => `[v${i}][a${i}]`).join("");
  filters.push(`${concatInputs}concat=n=5:v=1:a=1[vout][aout]`);

  // Ranks 5..1 appear as each segment starts (clip 0 = rank 5)
  let videoLabel = "[vout]";
  const rankOrder = [5, 4, 3, 2, 1];
  rankOrder.forEach((rank, chainIdx) => {
    const seg = segments.find((s) => s.rank === rank);
    const pos = positions[rank];
    const nextLabel = chainIdx === rankOrder.length - 1 ? "[vranked]" : `[vr${rank}]`;
    const dt = rankDrawtext({
      rank,
      start: seg.start,
      x: pos.x,
      y: pos.y,
      fontSize: pos.fontSize,
    });
    filters.push(`${videoLabel}${dt}${nextLabel}`);
    videoLabel = nextLabel;
  });

  filters.push(
    `${videoLabel}${titleDrawtext({
      title,
      x: titlePos.x,
      y: titlePos.y,
    })}[vfinal]`
  );

  let audioMap = "[aout]";
  const args = ["-y"];
  for (const clip of clips) {
    args.push("-i", clip);
  }

  if (bgmPath) {
    args.push("-stream_loop", "-1", "-i", bgmPath);
    const bgmIndex = clips.length;
    filters.push(
      `[${bgmIndex}:a]volume=${bgmVolume},atrim=0:${totalDuration},asetpts=PTS-STARTPTS[bgm]`
    );
    filters.push(`[aout][bgm]amix=inputs=2:duration=first:dropout_transition=0[amixed]`);
    audioMap = "[amixed]";
  }

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", "[vfinal]", "-map", audioMap);

  if (encoder === "h264_nvenc" || encoder === "hevc_nvenc") {
    args.push("-c:v", encoder, "-preset", "p4", "-rc", "vbr", "-cq", "19");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18");
  }

  args.push("-c:a", "aac", "-b:a", "192k", "-t", String(totalDuration), output);
  return args;
}
