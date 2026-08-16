import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fitDelogoRegion } from "./box.js";
import { safeDownloadFilename } from "./downloadFilename.js";
import { parseDownloadUrl } from "./downloadUrl.js";
import {
  cancelDownloadJob,
  createDownloadJob,
  getDownloadJob,
  listPublicDownloadJob,
} from "./downloadJobs.js";
import {
  cancelJob,
  checkBinaries,
  createAndStartJob,
  getJob,
  listPublicJob,
  pickEncoder,
  probeAudio,
  probeVideo,
} from "./jobs.js";
import {
  cancelRankingJob,
  createRankingJob,
  getRankingJob,
  listPublicRankingJob,
} from "./rankingJobs.js";
import {
  downloadsDir,
  ensureDirs,
  outputsDir,
  rankingBgmDir,
  rankingClipsDir,
  uploadsDir,
} from "./paths.js";
import { checkYtdlp, probeUrl } from "./ytdlp.js";

ensureDirs();

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 1024 });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 1024 * 1024 * 1024 * 8 },
});

/** @type {Map<string, object>} */
const uploads = new Map();
/** @type {Map<string, object>} */
const rankingClips = new Map();
/** @type {Map<string, object>} */
const rankingBgm = new Map();

let cachedEncoder = "libx264";
let binaries = { ffmpeg: false, ffprobe: false, ytdlp: false };

async function refreshEnv() {
  const ff = await checkBinaries();
  const ytdlp = await checkYtdlp();
  binaries = { ...ff, ytdlp };
  if (binaries.ffmpeg) {
    cachedEncoder = await pickEncoder();
  }
}

async function registerDownloadedUpload({ path: filePath, filename, title }) {
  const id = randomUUID();
  let meta;
  try {
    meta = await probeVideo(filePath);
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Could not read downloaded video"
    );
  }
  if (!meta.width || !meta.height) {
    throw new Error("Could not detect video dimensions");
  }
  uploads.set(id, {
    id,
    path: filePath,
    filename: title ? safeDownloadFilename(title) : filename,
    ...meta,
  });
  return id;
}

await refreshEnv();

app.get("/api/health", async () => ({
  ok: binaries.ffmpeg && binaries.ffprobe,
  ffmpeg: binaries.ffmpeg,
  ffprobe: binaries.ffprobe,
  ytdlp: Boolean(binaries.ytdlp),
  encoder: cachedEncoder,
}));

app.post("/api/upload", async (request, reply) => {
  if (!binaries.ffmpeg || !binaries.ffprobe) {
    return reply.code(503).send({
      error: "FFmpeg/ffprobe not found on PATH. Install FFmpeg and restart.",
    });
  }

  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ error: "No file uploaded" });
  }

  const id = randomUUID();
  const ext = path.extname(file.filename || "") || ".mp4";
  const storedName = `${id}${ext}`;
  const dest = path.join(uploadsDir, storedName);
  await fs.promises.writeFile(dest, await file.toBuffer());

  let meta;
  try {
    meta = await probeVideo(dest);
  } catch (err) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Could not read video",
    });
  }

  if (!meta.width || !meta.height) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({ error: "Could not detect video dimensions" });
  }

  uploads.set(id, {
    id,
    path: dest,
    filename: file.filename,
    ...meta,
  });

  return {
    id,
    filename: file.filename,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
  };
});

app.post("/api/process", async (request, reply) => {
  const body = request.body ?? {};
  const { uploadId, box } = body;
  const upload = uploads.get(uploadId);
  if (!upload) {
    return reply.code(404).send({ error: "Upload not found" });
  }
  if (!box) {
    return reply.code(400).send({ error: "box is required" });
  }

  let delogo;
  try {
    delogo = fitDelogoRegion(box, upload.width, upload.height, 8);
  } catch (err) {
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Invalid box",
    });
  }

  request.log.info(
    {
      uploadId,
      video: { w: upload.width, h: upload.height },
      box,
      delogo,
    },
    "starting delogo job"
  );

  const job = createAndStartJob({
    inputPath: upload.path,
    delogo,
    duration: upload.duration,
    preferredEncoder: cachedEncoder,
  });

  return { jobId: job.id, delogo };
});

app.get("/api/jobs/:id", async (request, reply) => {
  const job = getJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicJob(job);
});

app.post("/api/jobs/:id/cancel", async (request, reply) => {
  const job = cancelJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicJob(job);
});

app.get("/api/jobs/:id/download", async (request, reply) => {
  const job = getJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  if (job.status !== "done") {
    return reply.code(409).send({ error: "Job not finished" });
  }
  if (!fs.existsSync(job.outputPath)) {
    return reply.code(404).send({ error: "Output missing" });
  }
  reply.header(
    "Content-Disposition",
    `attachment; filename="cleaned-${job.outputName}"`
  );
  return reply.send(fs.createReadStream(job.outputPath));
});

app.post("/api/download/probe", async (request, reply) => {
  if (!binaries.ytdlp) {
    return reply.code(503).send({
      error: "yt-dlp not found on PATH. Install yt-dlp and restart.",
    });
  }
  const parsed = parseDownloadUrl(request.body?.url);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  try {
    return await probeUrl(parsed.url, parsed.platform);
  } catch (err) {
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Probe failed",
    });
  }
});

app.post("/api/download/start", async (request, reply) => {
  if (!binaries.ytdlp) {
    return reply.code(503).send({
      error: "yt-dlp not found on PATH. Install yt-dlp and restart.",
    });
  }
  if (!binaries.ffmpeg || !binaries.ffprobe) {
    return reply.code(503).send({
      error: "FFmpeg/ffprobe not found on PATH. Install FFmpeg and restart.",
    });
  }
  const parsed = parseDownloadUrl(request.body?.url);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

  let title = null;
  try {
    const info = await probeUrl(parsed.url, parsed.platform);
    title = info.title;
  } catch {
    /* title optional */
  }

  const tiktokFormat = Boolean(request.body?.tiktokFormat);

  const job = createDownloadJob({
    url: parsed.url,
    downloadsDir,
    title,
    tiktokFormat,
    preferredEncoder: cachedEncoder,
    registerUpload: registerDownloadedUpload,
  });
  return { jobId: job.id };
});

app.get("/api/download/:id", async (request, reply) => {
  const job = getDownloadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicDownloadJob(job);
});

app.post("/api/download/:id/cancel", async (request, reply) => {
  const job = cancelDownloadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicDownloadJob(job);
});

app.get("/api/download/:id/file", async (request, reply) => {
  const job = getDownloadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  if (job.status !== "done") {
    return reply.code(409).send({ error: "Job not finished" });
  }
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    return reply.code(404).send({ error: "Output missing" });
  }
  const name = safeDownloadFilename(job.title || job.outputName);
  reply.header("Content-Disposition", `attachment; filename="${name}"`);
  return reply.send(fs.createReadStream(job.outputPath));
});

app.get("/api/uploads/:id", async (request, reply) => {
  const upload = uploads.get(request.params.id);
  if (!upload) return reply.code(404).send({ error: "Upload not found" });
  return {
    id: upload.id,
    filename: upload.filename,
    width: upload.width,
    height: upload.height,
    duration: upload.duration,
  };
});

app.get("/api/uploads/:id/media", async (request, reply) => {
  const upload = uploads.get(request.params.id);
  if (!upload) return reply.code(404).send({ error: "Upload not found" });
  if (!fs.existsSync(upload.path)) {
    return reply.code(404).send({ error: "File missing" });
  }
  return reply.send(fs.createReadStream(upload.path));
});

app.post("/api/ranking/clips", async (request, reply) => {
  if (!binaries.ffmpeg || !binaries.ffprobe) {
    return reply.code(503).send({
      error: "FFmpeg/ffprobe not found on PATH. Install FFmpeg and restart.",
    });
  }

  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ error: "No file uploaded" });
  }

  const id = randomUUID();
  const ext = path.extname(file.filename || "") || ".mp4";
  const storedName = `${id}${ext}`;
  const dest = path.join(rankingClipsDir, storedName);
  await fs.promises.writeFile(dest, await file.toBuffer());

  let meta;
  try {
    meta = await probeVideo(dest);
  } catch (err) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Could not read video",
    });
  }

  if (!meta.width || !meta.height) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({ error: "Could not detect video dimensions" });
  }
  if (!(meta.duration > 0)) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({ error: "Clip duration must be greater than 0" });
  }

  rankingClips.set(id, {
    id,
    path: dest,
    filename: file.filename,
    ...meta,
    hasAudio: Boolean(meta.hasAudio),
  });

  return {
    id,
    filename: file.filename,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    hasAudio: Boolean(meta.hasAudio),
  };
});

app.post("/api/ranking/bgm", async (request, reply) => {
  if (!binaries.ffmpeg || !binaries.ffprobe) {
    return reply.code(503).send({
      error: "FFmpeg/ffprobe not found on PATH. Install FFmpeg and restart.",
    });
  }

  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ error: "No file uploaded" });
  }

  const id = randomUUID();
  const ext = path.extname(file.filename || "") || ".mp3";
  const storedName = `${id}${ext}`;
  const dest = path.join(rankingBgmDir, storedName);
  await fs.promises.writeFile(dest, await file.toBuffer());

  try {
    const audioMeta = await probeAudio(dest);
    if (!audioMeta.hasAudio) {
      await fs.promises.unlink(dest).catch(() => {});
      return reply
        .code(400)
        .send({ error: "File must contain at least one audio stream" });
    }
  } catch (err) {
    await fs.promises.unlink(dest).catch(() => {});
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Could not read audio",
    });
  }

  rankingBgm.set(id, {
    id,
    path: dest,
    filename: file.filename,
  });

  return { id, filename: file.filename };
});

app.post("/api/ranking/export", async (request, reply) => {
  if (!binaries.ffmpeg || !binaries.ffprobe) {
    return reply.code(503).send({
      error: "FFmpeg/ffprobe not found on PATH. Install FFmpeg and restart.",
    });
  }

  const body = request.body ?? {};
  const {
    clipIds,
    title,
    titlePos,
    titleFont,
    titleSize,
    titleWeight,
    titleColor,
    titleAlign,
    titleBorder,
    ranksPos,
    captions,
    clipVolumes,
    masterVolume,
    muteClips,
    bgmId,
    bgmVolume,
    titleWidth,
    titleWrap,
    captionWidths,
    captionWraps,
  } = body;

  const validTitleFonts = new Set([
    "arial",
    "impact",
    "segoe",
    "georgia",
    "consolas",
  ]);
  const validTitleWeights = new Set(["regular", "bold"]);
  const validTitleAligns = new Set(["left", "center", "right"]);
  const normalizedTitleFont = validTitleFonts.has(titleFont)
    ? titleFont
    : "arial";
  const normalizedTitleWeight = validTitleWeights.has(titleWeight)
    ? titleWeight
    : "bold";
  const normalizedTitleAlign = validTitleAligns.has(titleAlign)
    ? titleAlign
    : "left";
  const normalizedTitleSize =
    Number.isFinite(titleSize) && titleSize >= 12 && titleSize <= 200
      ? titleSize
      : 64;
  const titleColorRaw =
    typeof titleColor === "string" ? titleColor.trim() : "";
  const normalizedTitleColor = /^#?[0-9a-fA-F]{6}$/.test(titleColorRaw)
    ? titleColorRaw.startsWith("#")
      ? titleColorRaw
      : `#${titleColorRaw}`
    : "#ffffff";

  if (!Array.isArray(clipIds) || clipIds.length !== 5) {
    return reply.code(400).send({ error: "Exactly 5 clipIds are required" });
  }
  if (!title || typeof title !== "string") {
    return reply.code(400).send({ error: "title is required" });
  }
  if (
    !titlePos ||
    typeof titlePos.x !== "number" ||
    typeof titlePos.y !== "number"
  ) {
    return reply
      .code(400)
      .send({ error: "titlePos with numeric x and y is required" });
  }

  const clips = [];
  for (const clipId of clipIds) {
    const clip = rankingClips.get(clipId);
    if (!clip) {
      return reply.code(404).send({ error: `Clip not found: ${clipId}` });
    }
    clips.push(clip);
  }

  let bgmPath = null;
  if (bgmId) {
    const bgm = rankingBgm.get(bgmId);
    if (!bgm) {
      return reply.code(404).send({ error: "BGM not found" });
    }
    bgmPath = bgm.path;
  }

  if (muteClips && !bgmPath) {
    return reply
      .code(400)
      .send({ error: "Background music is required when clips are muted" });
  }

  const job = createRankingJob({
    clipPaths: clips.map((c) => c.path),
    durations: clips.map((c) => c.duration),
    hasAudio: clips.map((c) => Boolean(c.hasAudio)),
    title,
    titlePos,
    titleFont: normalizedTitleFont,
    titleSize: normalizedTitleSize,
    titleWeight: normalizedTitleWeight,
    titleColor: normalizedTitleColor,
    titleAlign: normalizedTitleAlign,
    titleBorder: titleBorder ?? 3,
    titleWidth: titleWidth ?? 900,
    titleWrap: titleWrap !== false,
    ranksPos: ranksPos ?? { x: 0, y: 0 },
    captions: Array.isArray(captions) ? captions : ["", "", "", "", ""],
    captionWidths: Array.isArray(captionWidths) ? captionWidths : undefined,
    captionWraps: Array.isArray(captionWraps) ? captionWraps : undefined,
    clipVolumes: Array.isArray(clipVolumes) ? clipVolumes : [1, 1, 1, 1, 1],
    masterVolume: masterVolume ?? 1,
    muteClips: Boolean(muteClips),
    bgmPath,
    bgmVolume: bgmVolume ?? 0.3,
    encoder: cachedEncoder,
  });

  return { jobId: job.id };
});

app.get("/api/ranking/jobs/:id", async (request, reply) => {
  const job = getRankingJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicRankingJob(job);
});

app.post("/api/ranking/jobs/:id/cancel", async (request, reply) => {
  const job = cancelRankingJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  return listPublicRankingJob(job);
});

app.get("/api/ranking/jobs/:id/download", async (request, reply) => {
  const job = getRankingJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "Job not found" });
  if (job.status !== "done") {
    return reply.code(409).send({ error: "Job not finished" });
  }
  if (!fs.existsSync(job.outputPath)) {
    return reply.code(404).send({ error: "Output missing" });
  }
  reply.header(
    "Content-Disposition",
    `attachment; filename="ranking-${job.outputName}"`
  );
  return reply.send(fs.createReadStream(job.outputPath));
});

const port = Number(process.env.PORT || 8787);
await app.listen({ port, host: "127.0.0.1" });
console.log(`API http://127.0.0.1:${port} encoder=${cachedEncoder}`);
