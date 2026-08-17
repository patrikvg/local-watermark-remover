import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildCropExtractArgs,
  buildMaskArgs,
  buildOverlayArgs,
  buildFpsProbeArgs,
  parseFrameRate,
} from "./ffmpegArgs.js";
import {
  mapInpaintProgress,
  parseWorkerFrameLine,
  spawnWorker,
} from "./inpaint.js";
import { formatFfmpegError } from "./box.js";
import { outputsDir } from "./paths.js";

/** @type {Map<string, object>} */
const jobs = new Map();

function parseTimeToSeconds(value) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function createJobState(fields) {
  const id = fields.id || randomUUID();
  const job = {
    id,
    status: "queued",
    progress: 0,
    error: null,
    proc: null,
    encoder: null,
    outputName: null,
    outputPath: null,
    workDir: null,
    ...fields,
  };
  jobs.set(id, job);
  return job;
}

function rmWorkDir(job) {
  if (job.workDir && fs.existsSync(job.workDir)) {
    fs.rmSync(job.workDir, { recursive: true, force: true });
  }
}

function spawnTracked(job, cmd, args) {
  const proc = spawn(cmd, args, { windowsHide: true });
  job.proc = proc;
  return proc;
}

function runFfmpegPhase(job, args, phase) {
  return new Promise((resolve, reject) => {
    const proc = spawnTracked(job, "ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (buf) => {
      const text = buf.toString();
      stderr += text;
      const timeMatch = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(text);
      if (timeMatch && job.duration > 0) {
        const t = parseTimeToSeconds(timeMatch[1]);
        if (t != null) {
          job.progress = Math.min(
            0.99,
            mapInpaintProgress(phase, t / job.duration)
          );
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

function probeFps(inputPath) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", buildFpsProbeArgs(inputPath), {
      windowsHide: true,
    });
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("error", () => resolve(30));
    proc.on("close", () => resolve(parseFrameRate(out)));
  });
}

function runWorkerPhase(job) {
  return new Promise((resolve, reject) => {
    const proc = spawnWorker({
      python: job.python,
      inputDir: path.join(job.workDir, "crop"),
      mask: path.join(job.workDir, "mask.png"),
      outputDir: path.join(job.workDir, "fill"),
    });
    job.proc = proc;
    let err = "";
    proc.stderr.on("data", (buf) => {
      const text = buf.toString();
      err += text;
      for (const line of text.split(/\r?\n/)) {
        const parsed = parseWorkerFrameLine(line);
        if (parsed) {
          job.progress = mapInpaintProgress("worker", parsed.i / parsed.n);
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
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `inpaint killed (${signal})`
            : err.trim().slice(-400) || `inpaint exited ${code}`
        )
      );
    });
  });
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

export function createAndStartJob({
  inputPath,
  region,
  duration,
  preferredEncoder,
  python,
}) {
  const id = randomUUID();
  const outputName = `${id}.mp4`;
  const outputPath = path.join(outputsDir, outputName);
  const workDir = path.join(outputsDir, `inpaint-${id}`);
  const job = createJobState({
    id,
    inputPath,
    outputPath,
    outputName,
    region,
    duration: duration || 0,
    encoder: preferredEncoder,
    python,
    workDir,
  });

  (async () => {
    job.status = "running";
    try {
      fs.mkdirSync(path.join(workDir, "crop"), { recursive: true });
      fs.mkdirSync(path.join(workDir, "fill"), { recursive: true });
      const fps = await probeFps(inputPath);
      job.fps = fps;

      await runFfmpegPhase(
        job,
        buildMaskArgs({
          crop: region.crop,
          mask: region.mask,
          output: path.join(workDir, "mask.png"),
        }),
        "crop"
      );
      await runFfmpegPhase(
        job,
        buildCropExtractArgs({
          input: inputPath,
          crop: region.crop,
          pattern: path.join(workDir, "crop", "frame_%06d.png"),
        }),
        "crop"
      );
      await runWorkerPhase(job);

      const overlayOnce = (encoder) =>
        runFfmpegPhase(
          job,
          buildOverlayArgs({
            input: inputPath,
            fillPattern: path.join(workDir, "fill", "frame_%06d.png"),
            output: outputPath,
            crop: region.crop,
            feather: region.feather,
            fps,
            encoder,
          }),
          "overlay"
        );

      try {
        await overlayOnce(preferredEncoder);
        job.encoder = preferredEncoder;
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
          await overlayOnce("libx264");
          job.encoder = "libx264";
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
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          /* ignore */
        }
      }
    } finally {
      if (job.status !== "running") {
        rmWorkDir(job);
      }
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
  rmWorkDir(job);
  return job;
}
