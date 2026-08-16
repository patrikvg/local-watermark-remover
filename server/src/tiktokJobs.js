import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildTiktokFormatArgs } from "./tiktokFormat.js";

/** @type {Map<string, object>} */
const jobs = new Map();

export function getTiktokJob(id) {
  return jobs.get(id) ?? null;
}

export function listPublicTiktokJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputName: job.outputName,
    uploadId: job.uploadId,
    filename: job.filename,
  };
}

function removeJobFiles(job) {
  for (const p of [job.inputPath, job.outputPath]) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

async function defaultRunConvert(job) {
  const outputName = `${job.id}.tiktok.mp4`;
  const outputPath = path.join(job.tiktokDir, outputName);
  const args = buildTiktokFormatArgs({
    input: job.inputPath,
    output: outputPath,
    encoder: job.preferredEncoder || "libx264",
  });

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    job.proc = proc;
    let stderr = "";
    proc.stderr?.on("data", (buf) => {
      const text = buf.toString();
      stderr += text;
      const timeMatch = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(text);
      if (timeMatch && job.duration > 0) {
        const parts = timeMatch[1].split(":");
        const t =
          Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
        if (Number.isFinite(t)) {
          job.progress = Math.min(0.95, t / job.duration);
        }
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        if (!fs.existsSync(outputPath)) {
          reject(new Error("Convert finished but output missing"));
          return;
        }
        job.outputPath = outputPath;
        job.outputName = outputName;
        job.progress = 1;
        resolve();
        return;
      }
      const msg =
        stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
        `ffmpeg exited ${code}`;
      reject(new Error(msg));
    });
  });
}

export function createTiktokJob({
  inputPath,
  tiktokDir,
  registerUpload,
  filename = null,
  duration = 0,
  preferredEncoder = "libx264",
  runConvert = defaultRunConvert,
}) {
  const id = randomUUID();
  const job = {
    id,
    inputPath,
    tiktokDir,
    filename,
    duration: duration || 0,
    preferredEncoder,
    status: "queued",
    progress: 0,
    error: null,
    outputPath: null,
    outputName: null,
    uploadId: null,
    proc: null,
  };
  jobs.set(id, job);

  (async () => {
    job.status = "running";
    try {
      await runConvert(job);
      if (job.status === "cancelled") return;
      job.uploadId = await registerUpload({
        path: job.outputPath,
        filename: job.outputName,
        title: filename ? String(filename).replace(/\.[^.]+$/, "") : null,
      });
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

export function cancelTiktokJob(id) {
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
  removeJobFiles(job);
  return job;
}
