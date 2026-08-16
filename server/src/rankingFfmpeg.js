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
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function fontfileOption() {
  if (process.platform === "win32") {
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

function audioChain(i, muteClips, duration, clipHasAudio, clipVolume) {
  const vol = Number.isFinite(clipVolume) ? Math.max(0, Math.min(2, clipVolume)) : 1;
  if (muteClips || !clipHasAudio) {
    return (
      `anullsrc=channel_layout=stereo:sample_rate=44100,` +
      `atrim=0:${duration},asetpts=PTS-STARTPTS[a${i}]`
    );
  }
  return (
    `[${i}:a]volume=${vol},apad,atrim=0:${duration},` +
    `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
    `asetpts=PTS-STARTPTS[a${i}]`
  );
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

function captionDrawtext({ caption, start, x, y, fontSize }) {
  if (!caption || !String(caption).trim()) return null;
  const anim = ANIM_SECONDS;
  const font = fontfileOption();
  const escaped = escapeDrawtext(String(caption).trim());
  const size = Math.max(28, Math.round(fontSize * 0.35));
  return (
    `drawtext=${font}text='${escaped}':` +
    `fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black:` +
    `x='if(lt(t-${start}\\,${anim})\\,-tw+(t-${start})/${anim}*(${x}+tw)\\,${x})':` +
    `y=${y}:enable='gte(t\\,${start})'`
  );
}

function titleDrawtext({ title, x, y, borderW }) {
  const font = fontfileOption();
  const escaped = escapeDrawtext(title);
  const bw = Math.max(0, Math.round(Number(borderW) || 0));
  return (
    `drawtext=${font}text='${escaped}':` +
    `fontsize=64:fontcolor=white:borderw=${bw}:bordercolor=black:` +
    `line_spacing=8:x=${x}:y=${y}`
  );
}

/**
 * @param {{
 *   clips: string[],
 *   durations: number[],
 *   title: string,
 *   titlePos: { x: number, y: number },
 *   titleBorder?: number,
 *   ranksPos?: { x: number, y: number },
 *   captions?: string[],
 *   clipVolumes?: number[],
 *   masterVolume?: number,
 *   muteClips: boolean,
 *   bgmPath: string | null,
 *   bgmVolume: number,
 *   encoder: string,
 *   output: string,
 *   hasAudio?: boolean[],
 * }} opts
 */
export function buildRankingArgs({
  clips,
  durations,
  title,
  titlePos,
  titleBorder = 3,
  ranksPos = { x: 0, y: 0 },
  captions = ["", "", "", "", ""],
  clipVolumes = [1, 1, 1, 1, 1],
  masterVolume = 1,
  muteClips,
  bgmPath,
  bgmVolume,
  encoder,
  output,
  hasAudio,
}) {
  if (!Array.isArray(clips) || clips.length !== 5) {
    throw new Error("Exactly 5 clips required");
  }
  if (muteClips && !bgmPath) {
    throw new Error("Background music is required when clips are muted");
  }

  const audioFlags =
    Array.isArray(hasAudio) && hasAudio.length === 5
      ? hasAudio.map(Boolean)
      : [true, true, true, true, true];

  const volumes =
    Array.isArray(clipVolumes) && clipVolumes.length === 5
      ? clipVolumes
      : [1, 1, 1, 1, 1];

  const caps =
    Array.isArray(captions) && captions.length === 5
      ? captions.map((c) => String(c ?? ""))
      : ["", "", "", "", ""];

  const segments = buildSegments(durations);
  const positions = stackPositions({
    originX: Number(ranksPos?.x) || 0,
    originY: Number(ranksPos?.y) || 0,
  });
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const master = Math.max(0, Math.min(2, Number(masterVolume) || 1));

  const filters = [];

  for (let i = 0; i < 5; i++) {
    filters.push(videoChain(i));
    filters.push(
      audioChain(i, muteClips, durations[i], audioFlags[i], volumes[i])
    );
  }

  const concatInputs = [0, 1, 2, 3, 4].map((i) => `[v${i}][a${i}]`).join("");
  filters.push(`${concatInputs}concat=n=5:v=1:a=1[vout][aout]`);

  let videoLabel = "[vout]";
  let chain = 0;
  const pushDraw = (dt) => {
    const nextLabel = `[vd${chain++}]`;
    filters.push(`${videoLabel}${dt}${nextLabel}`);
    videoLabel = nextLabel;
  };

  // Countdown appearance 5→1; stack layout 1 top / 5 bottom
  for (const rank of [5, 4, 3, 2, 1]) {
    const seg = segments.find((s) => s.rank === rank);
    const pos = positions[rank];
    pushDraw(
      rankDrawtext({
        rank,
        start: seg.start,
        x: pos.x,
        y: pos.y,
        fontSize: pos.fontSize,
      })
    );
    const cap = caps[seg.index];
    const capDt = captionDrawtext({
      caption: cap,
      start: seg.start,
      x: pos.x + Math.round(pos.fontSize * 0.85),
      y: pos.y + Math.round(pos.fontSize * 0.35),
      fontSize: pos.fontSize,
    });
    if (capDt) pushDraw(capDt);
  }

  filters.push(
    `${videoLabel}${titleDrawtext({
      title,
      x: titlePos.x,
      y: titlePos.y,
      borderW: titleBorder,
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
    filters.push(
      `[aout][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]`
    );
    audioMap = "[amixed]";
  }

  if (master !== 1) {
    filters.push(`${audioMap}volume=${master}[afinal]`);
    audioMap = "[afinal]";
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
