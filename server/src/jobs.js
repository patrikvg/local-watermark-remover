import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildDelogoArgs } from "./ffmpegArgs.js";
import { formatFfmpegError } from "./box.js";
import { outputsDir } from "./paths.js";

/** @type {Map<string, object>} */
const jobs = new Map();

function parseTimeToSeconds(value) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function listPublicJob(job) {
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

export function pickEncoder() {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-encoders"], {
      windowsHide: true,
    });
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("error", () => resolve("libx264"));
    proc.on("close", () => {
      resolve(out.includes("h264_nvenc") ? "h264_nvenc" : "libx264");
    });
  });
}

export function checkBinaries() {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { windowsHide: true });
    let ok = false;
    proc.on("error", () => resolve({ ffmpeg: false, ffprobe: false }));
    proc.on("close", (code) => {
      ok = code === 0;
      const probe = spawn("ffprobe", ["-version"], { windowsHide: true });
      probe.on("error", () => resolve({ ffmpeg: ok, ffprobe: false }));
      probe.on("close", (pCode) =>
        resolve({ ffmpeg: ok, ffprobe: pCode === 0 })
      );
    });
  });
}

export function probeVideo(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height:format=duration",
      "-of",
      "json",
      inputPath,
    ];
    const proc = spawn("ffprobe", args, { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || "ffprobe failed"));
        return;
      }
      try {
        const json = JSON.parse(out);
        const streams = json.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video") ?? {};
        const hasAudio = streams.some((s) => s.codec_type === "audio");
        const duration = Number(json.format?.duration ?? video.duration ?? 0);
        resolve({
          width: Number(video.width) || 0,
          height: Number(video.height) || 0,
          duration: Number.isFinite(duration) ? duration : 0,
          hasAudio,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** Returns true if the file has at least one audio stream. */
export function probeAudio(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "json",
      inputPath,
    ];
    const proc = spawn("ffprobe", args, { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || "ffprobe failed"));
        return;
      }
      try {
        const json = JSON.parse(out);
        const hasAudio = (json.streams ?? []).some(
          (s) => s.codec_type === "audio"
        );
        resolve({ hasAudio });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function runFfmpeg(job, encoder) {
  return new Promise((resolve, reject) => {
    const args = buildDelogoArgs({
      input: job.inputPath,
      output: job.outputPath,
      delogo: job.delogo,
      encoder,
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

export function createAndStartJob({
  inputPath,
  delogo,
  duration,
  preferredEncoder,
}) {
  const id = randomUUID();
  const outputName = `${id}.mp4`;
  const outputPath = path.join(outputsDir, outputName);
  const job = {
    id,
    status: "queued",
    progress: 0,
    error: null,
    inputPath,
    outputPath,
    outputName,
    delogo,
    duration: duration || 0,
    encoder: preferredEncoder,
    proc: null,
  };
  jobs.set(id, job);

  (async () => {
    job.status = "running";
    try {
      try {
        await runFfmpeg(job, preferredEncoder);
      } catch (err) {
        if (
          preferredEncoder !== "libx264" &&
          job.status !== "cancelled" &&
          fs.existsSync(inputPath)
        ) {
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch {
              /* ignore */
            }
          }
          await runFfmpeg(job, "libx264");
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

export function cancelJob(id) {
  const job = jobs.get(id);
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
