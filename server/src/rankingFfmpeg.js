import {
  ANIM_SECONDS,
  CANVAS,
  RANK_FONT,
  RANK_LINE_HEIGHT,
  TITLE_FONT,
  TITLE_LINE_SPACING,
  CAPTION_LINE_SPACING,
  CAPTION_X_RATIO,
  buildSegments,
  stackPositions,
} from "./rankingTimeline.js";
import {
  centerAlong,
  overlayTextHeight,
  wrapOverlayText,
} from "./textWrap.js";

export { wrapOverlayText } from "./textWrap.js";

const DEFAULT_TITLE_WIDTH = 900;
const DEFAULT_CAPTION_WIDTH = 420;

export function rankFontColor(rank) {
  if (rank === 1) return "0xFFD700";
  if (rank === 2) return "0xC0C0C0";
  if (rank === 3) return "0xCD7F32";
  return "white";
}

function captionFontSize(rankFontSize) {
  return Math.max(28, Math.round(rankFontSize * 0.35));
}

export function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
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
  const color = rankFontColor(rank);
  return (
    `drawtext=${font}text=${rank}:` +
    `fontsize=${fontSize}:fontcolor=${color}:borderw=4:bordercolor=black:` +
    `x='if(lt(t-${start}\\,${anim})\\,-tw+(t-${start})/${anim}*(${x}+tw)\\,${x})':` +
    `y=${y}:enable='gte(t\\,${start})'`
  );
}

function captionDrawtext({ caption, start, x, y, fontSize }) {
  if (!caption || !String(caption).trim()) return null;
  const anim = ANIM_SECONDS;
  const font = fontfileOption();
  const escaped = escapeDrawtext(String(caption).trim());
  const size = Math.max(28, Math.round(Number(fontSize) || 0));
  return (
    `drawtext=${font}text='${escaped}':` +
    `fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black:` +
    `line_spacing=${CAPTION_LINE_SPACING}:` +
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
    `fontsize=${TITLE_FONT}:fontcolor=white:borderw=${bw}:bordercolor=black:` +
    `line_spacing=${TITLE_LINE_SPACING}:x=${x}:y=${y}`
  );
}

/**
 * @param {{
 *   clips: string[],
 *   durations: number[],
 *   title: string,
 *   titlePos: { x: number, y: number },
 *   titleBorder?: number,
 *   titleWidth?: number,
 *   titleWrap?: boolean,
 *   ranksPos?: { x: number, y: number },
 *   captions?: string[],
 *   captionWidths?: number[],
 *   captionWraps?: boolean[],
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
  titleWidth = DEFAULT_TITLE_WIDTH,
  titleWrap = true,
  ranksPos = { x: 0, y: 0 },
  captions = ["", "", "", "", ""],
  captionWidths = [DEFAULT_CAPTION_WIDTH, DEFAULT_CAPTION_WIDTH, DEFAULT_CAPTION_WIDTH, DEFAULT_CAPTION_WIDTH, DEFAULT_CAPTION_WIDTH],
  captionWraps = [true, true, true, true, true],
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

  const capWidths =
    Array.isArray(captionWidths) && captionWidths.length === 5
      ? captionWidths.map((w) => Math.max(40, Number(w) || DEFAULT_CAPTION_WIDTH))
      : [
          DEFAULT_CAPTION_WIDTH,
          DEFAULT_CAPTION_WIDTH,
          DEFAULT_CAPTION_WIDTH,
          DEFAULT_CAPTION_WIDTH,
          DEFAULT_CAPTION_WIDTH,
        ];

  const capWrapFlags =
    Array.isArray(captionWraps) && captionWraps.length === 5
      ? captionWraps.map((w) => w !== false)
      : [true, true, true, true, true];

  const wrappedTitle = wrapOverlayText(
    title,
    Number(titleWidth) > 0 ? Number(titleWidth) : DEFAULT_TITLE_WIDTH,
    TITLE_FONT,
    titleWrap !== false
  );

  const segments = buildSegments(durations);
  const positions = stackPositions({
    originX: Number(ranksPos?.x) || 0,
    originY: Number(ranksPos?.y) || 0,
    lineHeight: RANK_LINE_HEIGHT,
    fontSize: RANK_FONT,
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
    const capSize = captionFontSize(pos.fontSize);
    const wrappedCap = wrapOverlayText(
      cap,
      capWidths[seg.index],
      capSize,
      capWrapFlags[seg.index]
    );
    const capDt = captionDrawtext({
      caption: wrappedCap,
      start: seg.start,
      x: pos.x + Math.round(pos.fontSize * CAPTION_X_RATIO),
      y: centerAlong(
        pos.y,
        pos.fontSize,
        overlayTextHeight(
          wrappedCap.trim() ? wrappedCap.trim() : wrappedCap,
          capSize,
          CAPTION_LINE_SPACING
        )
      ),
      fontSize: capSize,
    });
    if (capDt) pushDraw(capDt);
  }

  filters.push(
    `${videoLabel}${titleDrawtext({
      title: wrappedTitle,
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
