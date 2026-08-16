import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatFfmpegError } from "./box.js";
import { outputsDir } from "./paths.js";
import { buildRankingArgs } from "./rankingFfmpeg.js";

/** @type {Map<string, object>} */
const rankingJobs = new Map();

function parseTimeToSeconds(value) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function getRankingJob(id) {
  return rankingJobs.get(id) ?? null;
}

export function listPublicRankingJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    encoder: job.encoder,
    outputName: job.outputName,
  };
}

function runRankingFfmpeg(job, encoder) {
  return new Promise((resolve, reject) => {
    const args = buildRankingArgs({
      clips: job.clipPaths,
      durations: job.durations,
      hasAudio: job.hasAudio,
      title: job.title,
      titlePos: job.titlePos,
      titleBorder: job.titleBorder,
      titleWidth: job.titleWidth,
      titleWrap: job.titleWrap,
      ranksPos: job.ranksPos,
      captions: job.captions,
      captionWidths: job.captionWidths,
      captionWraps: job.captionWraps,
      clipVolumes: job.clipVolumes,
      masterVolume: job.masterVolume,
      muteClips: job.muteClips,
      bgmPath: job.bgmPath,
      bgmVolume: job.bgmVolume,
      encoder,
      output: job.outputPath,
    });
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    job.proc = proc;
    job.encoder = encoder;
    let stderr = "";

    proc.stderr.on("data", (buf) => {
      const text = buf.toString();
      stderr += text;
      const timeMatch = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(text);
      if (timeMatch && job.duration > 0) {
        const t = parseTimeToSeconds(timeMatch[1]);
        if (t != null) {
          job.progress = Math.min(0.99, t / job.duration);
        }
      }
    });

    proc.on("error", (e) => reject(e));
    proc.on("close", (code, signal) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        job.progress = 1;
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `ffmpeg killed (${signal})`
            : formatFfmpegError(stderr) || `ffmpeg exited ${code}`
        )
      );
    });
  });
}

export function createRankingJob({
  clipPaths,
  durations,
  hasAudio,
  title,
  titlePos,
  titleBorder = 3,
  titleWidth = 900,
  titleWrap = true,
  ranksPos = { x: 0, y: 0 },
  captions = ["", "", "", "", ""],
  captionWidths,
  captionWraps,
  clipVolumes = [1, 1, 1, 1, 1],
  masterVolume = 1,
  muteClips,
  bgmPath,
  bgmVolume,
  encoder: preferredEncoder,
}) {
  const id = randomUUID();
  const outputName = `${id}.mp4`;
  const outputPath = path.join(outputsDir, outputName);
  const duration = (durations || []).reduce(
    (sum, d) => sum + (Number(d) || 0),
    0
  );
  const job = {
    id,
    status: "queued",
    progress: 0,
    error: null,
    clipPaths,
    durations,
    hasAudio: Array.isArray(hasAudio) ? hasAudio.map(Boolean) : undefined,
    title,
    titlePos,
    titleBorder: Number(titleBorder) || 0,
    titleWidth: Number(titleWidth) || 900,
    titleWrap: titleWrap !== false,
    ranksPos: {
      x: Number(ranksPos?.x) || 0,
      y: Number(ranksPos?.y) || 0,
    },
    captions: Array.isArray(captions)
      ? captions.map((c) => String(c ?? "")).slice(0, 5)
      : ["", "", "", "", ""],
    captionWidths: Array.isArray(captionWidths)
      ? captionWidths.map((w) => Number(w) || 420).slice(0, 5)
      : undefined,
    captionWraps: Array.isArray(captionWraps)
      ? captionWraps.map((w) => w !== false).slice(0, 5)
      : undefined,
    clipVolumes: Array.isArray(clipVolumes)
      ? clipVolumes.map((v) => Number(v) || 0).slice(0, 5)
      : [1, 1, 1, 1, 1],
    masterVolume: Number(masterVolume) || 1,
    muteClips: Boolean(muteClips),
    bgmPath: bgmPath ?? null,
    bgmVolume: Number(bgmVolume) || 0.3,
    outputPath,
    outputName,
    duration,
    encoder: preferredEncoder,
    proc: null,
  };
  rankingJobs.set(id, job);

  (async () => {
    job.status = "running";
    try {
      try {
        await runRankingFfmpeg(job, preferredEncoder);
      } catch (err) {
        if (
          preferredEncoder !== "libx264" &&
          job.status !== "cancelled"
        ) {
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch {
              /* ignore */
            }
          }
          await runRankingFfmpeg(job, "libx264");
        } else {
          throw err;
        }
      }
      if (job.status !== "cancelled") {
        job.status = "done";
        job.progress = 1;
      }
    } catch (err) {
      if (job.status === "cancelled") return;
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    }
  })();

  return job;
}

export function cancelRankingJob(id) {
  const job = rankingJobs.get(id);
  if (!job) return null;
  if (job.status === "done" || job.status === "error") return job;
  job.status = "cancelled";
  job.error = "Cancelled";
  if (job.proc) {
    try {
      job.proc.kill();
    } catch {
      /* ignore */
    }
  }
  if (job.outputPath && fs.existsSync(job.outputPath)) {
    try {
      fs.unlinkSync(job.outputPath);
    } catch {
      /* ignore */
    }
  }
  return job;
}
