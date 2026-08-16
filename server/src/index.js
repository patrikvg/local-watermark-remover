import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { normalizeBox, toDelogoParams } from "./box.js";
import {
  cancelJob,
  checkBinaries,
  createAndStartJob,
  getJob,
  listPublicJob,
  pickEncoder,
  probeVideo,
} from "./jobs.js";
import { ensureDirs, outputsDir, uploadsDir } from "./paths.js";

ensureDirs();

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 1024 });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 1024 * 1024 * 1024 * 8 },
});

/** @type {Map<string, object>} */
const uploads = new Map();

let cachedEncoder = "libx264";
let binaries = { ffmpeg: false, ffprobe: false };

async function refreshEnv() {
  binaries = await checkBinaries();
  if (binaries.ffmpeg) {
    cachedEncoder = await pickEncoder();
  }
}

await refreshEnv();

app.get("/api/health", async () => ({
  ok: binaries.ffmpeg && binaries.ffprobe,
  ffmpeg: binaries.ffmpeg,
  ffprobe: binaries.ffprobe,
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

  let normalized;
  try {
    normalized = normalizeBox(box, upload.width, upload.height);
  } catch (err) {
    return reply.code(400).send({
      error: err instanceof Error ? err.message : "Invalid box",
    });
  }

  const expanded = toDelogoParams(normalized, 8);
  const delogo = {
    x: Math.max(0, Math.min(expanded.x, upload.width - 2)),
    y: Math.max(0, Math.min(expanded.y, upload.height - 2)),
    w: Math.max(2, Math.min(expanded.w, upload.width - Math.max(0, expanded.x))),
    h: Math.max(2, Math.min(expanded.h, upload.height - Math.max(0, expanded.y))),
    show: 0,
  };
  delogo.w = delogo.w % 2 === 0 ? delogo.w : delogo.w - 1;
  delogo.h = delogo.h % 2 === 0 ? delogo.h : delogo.h - 1;
  delogo.x = delogo.x % 2 === 0 ? delogo.x : delogo.x - 1;
  delogo.y = delogo.y % 2 === 0 ? delogo.y : delogo.y - 1;
  const job = createAndStartJob({
    inputPath: upload.path,
    delogo,
    duration: upload.duration,
    preferredEncoder: cachedEncoder,
  });

  return { jobId: job.id };
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

const port = Number(process.env.PORT || 8787);
await app.listen({ port, host: "127.0.0.1" });
console.log(`API http://127.0.0.1:${port} encoder=${cachedEncoder}`);
