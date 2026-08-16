import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDownloadJob,
  getDownloadJob,
  listPublicDownloadJob,
  cancelDownloadJob,
  resolveDownloadOutput,
} from "../src/downloadJobs.js";

describe("downloadJobs", () => {
  it("runs to done and exposes uploadId from registerUpload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-job-"));
    const outFile = path.join(dir, "clip.mp4");
    const registerUpload = vi.fn(async () => "upload-1");

    const job = createDownloadJob({
      url: "https://youtu.be/x",
      downloadsDir: dir,
      registerUpload,
      runDownload: async (j, onProgress) => {
        onProgress(0.5);
        fs.writeFileSync(outFile, "fake");
        j.outputPath = outFile;
        j.outputName = "clip.mp4";
        onProgress(1);
      },
    });

    expect(listPublicDownloadJob(job).status).toBe("running");

    await vi.waitFor(() => {
      expect(getDownloadJob(job.id).status).toBe("done");
    });

    const pub = listPublicDownloadJob(getDownloadJob(job.id));
    expect(pub.progress).toBe(1);
    expect(pub.uploadId).toBe("upload-1");
    expect(registerUpload).toHaveBeenCalled();
  });

  it("cancel stops a running job and removes all job-prefixed files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-job-"));
    let release;
    const gate = new Promise((r) => {
      release = r;
    });

    const job = createDownloadJob({
      url: "https://youtu.be/x",
      downloadsDir: dir,
      registerUpload: async () => "u",
      runDownload: async (j) => {
        j.proc = { kill: vi.fn() };
        await gate;
      },
    });

    const partial = path.join(dir, `${job.id}.webm.part`);
    const intermediate = path.join(dir, `${job.id}.f137.mp4`);
    const unrelated = path.join(dir, "unrelated.mp4");
    fs.writeFileSync(partial, "partial");
    fs.writeFileSync(intermediate, "intermediate");
    fs.writeFileSync(unrelated, "keep");

    cancelDownloadJob(job.id);
    expect(job.proc.kill).toHaveBeenCalled();
    expect(fs.existsSync(partial)).toBe(false);
    expect(fs.existsSync(intermediate)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);

    release();
    await vi.waitFor(() => {
      expect(getDownloadJob(job.id).status).toBe("cancelled");
    });
  });

  it("resolves the actual output and prefers mp4 when multiple files exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-job-"));
    const job = { id: "job-1", downloadsDir: dir };
    fs.writeFileSync(path.join(dir, "job-1.webm"), "webm");
    fs.writeFileSync(path.join(dir, "job-1.mp4"), "mp4");
    fs.writeFileSync(path.join(dir, "other.mp4"), "other");

    expect(resolveDownloadOutput(job)).toEqual({
      outputPath: path.join(dir, "job-1.mp4"),
      outputName: "job-1.mp4",
    });
  });

  it("resolves a non-mp4 output when it is the only completed file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-job-"));
    const job = { id: "job-2", downloadsDir: dir };
    fs.writeFileSync(path.join(dir, "job-2.webm"), "webm");

    expect(resolveDownloadOutput(job)).toEqual({
      outputPath: path.join(dir, "job-2.webm"),
      outputName: "job-2.webm",
    });
  });

  it("runs convert when tiktokFormat is true before registerUpload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-tt-"));
    const raw = path.join(dir, "raw.mp4");
    const converted = path.join(dir, "tt.mp4");
    const registerUpload = vi.fn(async ({ path: p }) => {
      expect(p).toBe(converted);
      return "upload-tt";
    });
    const runConvert = vi.fn(async (job) => {
      fs.writeFileSync(converted, "tiktok");
      job.outputPath = converted;
      job.outputName = "tt.mp4";
    });

    const job = createDownloadJob({
      url: "https://youtu.be/x",
      downloadsDir: dir,
      registerUpload,
      tiktokFormat: true,
      preferredEncoder: "libx264",
      runDownload: async (j, onProgress) => {
        fs.writeFileSync(raw, "raw");
        j.outputPath = raw;
        j.outputName = "raw.mp4";
        onProgress(1);
      },
      runConvert,
    });

    await vi.waitFor(() => {
      expect(getDownloadJob(job.id).status).toBe("done");
    });

    expect(runConvert).toHaveBeenCalled();
    expect(listPublicDownloadJob(getDownloadJob(job.id)).uploadId).toBe(
      "upload-tt"
    );
    expect(listPublicDownloadJob(getDownloadJob(job.id)).tiktokFormat).toBe(
      true
    );
  });
});
