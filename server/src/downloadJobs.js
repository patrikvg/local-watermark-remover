import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildTiktokFormatArgs } from "./tiktokFormat.js";
import { buildDownloadArgs, parseProgressLine } from "./ytdlp.js";

/** @type {Map<string, object>} */
const jobs = new Map();

export function getDownloadJob(id) {
  return jobs.get(id) ?? null;
}

export function listPublicDownloadJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputName: job.outputName,
    uploadId: job.uploadId,
    title: job.title,
    tiktokFormat: Boolean(job.tiktokFormat),
    phase: job.phase ?? null,
  };
}

function removeDownloadFiles(job) {
  let names;
  try {
    names = fs.readdirSync(job.downloadsDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(job.id)) continue;
    try {
      fs.unlinkSync(path.join(job.downloadsDir, name));
    } catch {
      /* ignore */
    }
  }
}

export function resolveDownloadOutput(job) {
  const names = fs
    .readdirSync(job.downloadsDir)
    .filter((name) => name.startsWith(`${job.id}.`))
    .sort();
  const outputName =
    names.find((name) => name.toLowerCase().endsWith(".mp4")) ?? names[0];
  if (!outputName) return null;
  return {
    outputPath: path.join(job.downloadsDir, outputName),
    outputName,
  };
}

async function defaultRunDownload(job, onProgress) {
  const template = path.join(job.downloadsDir, `${job.id}.%(ext)s`);
  const args = buildDownloadArgs({ url: job.url, outputTemplate: template });

  await new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { windowsHide: true });
    job.proc = proc;
    let stderr = "";

    const onChunk = (buf) => {
      const text = buf.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        const p = parseProgressLine(line);
        if (p != null) onProgress(Math.min(0.95, p));
      }
    };
    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);
    proc.on("error", reject);
    proc.on("close", (code) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        const output = resolveDownloadOutput(job);
        if (!output) {
          reject(new Error("Download finished but output file missing"));
          return;
        }
        job.outputPath = output.outputPath;
        job.outputName = output.outputName;
        onProgress(1);
        resolve();
        return;
      }
      const msg =
        stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
        `yt-dlp exited ${code}`;
      reject(new Error(msg));
    });
  });
}

async function defaultRunConvert(job) {
  const input = job.outputPath;
  const outputName = `${job.id}.tiktok.mp4`;
  const outputPath = path.join(job.downloadsDir, outputName);
  const args = buildTiktokFormatArgs({
    input,
    output: outputPath,
    encoder: job.preferredEncoder || "libx264",
  });

  await new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    job.proc = proc;
    let stderr = "";

    proc.stderr?.on("data", (buf) => {
      stderr += buf.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      job.proc = null;
      if (job.status === "cancelled") {
        reject(new Error("cancelled"));
        return;
      }
      if (code === 0) {
        try {
          if (input && input !== outputPath && fs.existsSync(input)) {
            fs.unlinkSync(input);
          }
        } catch {
          /* ignore */
        }
        job.outputPath = outputPath;
        job.outputName = outputName;
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

export function createDownloadJob({
  url,
  downloadsDir,
  registerUpload,
  title = null,
  tiktokFormat = false,
  preferredEncoder = "libx264",
  runDownload = defaultRunDownload,
  runConvert = defaultRunConvert,
}) {
  const id = randomUUID();
  const job = {
    id,
    url,
    downloadsDir,
    title,
    tiktokFormat: Boolean(tiktokFormat),
    preferredEncoder,
    status: "queued",
    phase: null,
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
      job.phase = "download";
      await runDownload(job, (p) => {
        if (job.status === "running") {
          job.progress = job.tiktokFormat ? Math.min(0.7, p * 0.7) : p;
        }
      });
      if (job.status === "cancelled") return;
      if (job.tiktokFormat) {
        job.phase = "convert";
        job.progress = Math.max(job.progress, 0.72);
        await runConvert(job);
        if (job.status === "cancelled") return;
        job.progress = 0.95;
      }
      job.phase = null;
      job.uploadId = await registerUpload({
        path: job.outputPath,
        filename: job.outputName,
        title: job.title,
      });
      if (job.status !== "cancelled") {
        job.status = "done";
        job.progress = 1;
      }
    } catch (err) {
      if (job.status === "cancelled") return;
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.phase = null;
    }
  })();

  return job;
}

export function cancelDownloadJob(id) {
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
  removeDownloadFiles(job);
  return job;
}
