import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTiktokJob,
  getTiktokJob,
  listPublicTiktokJob,
  cancelTiktokJob,
} from "../src/tiktokJobs.js";

describe("tiktokJobs", () => {
  it("converts then exposes uploadId from registerUpload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-job-"));
    const input = path.join(dir, "in.mp4");
    const out = path.join(dir, "out.mp4");
    fs.writeFileSync(input, "raw");
    const registerUpload = vi.fn(async ({ path: p }) => {
      expect(p).toBe(out);
      return "up-1";
    });

    const job = createTiktokJob({
      inputPath: input,
      tiktokDir: dir,
      preferredEncoder: "libx264",
      registerUpload,
      runConvert: async (j) => {
        fs.writeFileSync(out, "done");
        j.outputPath = out;
        j.outputName = "out.mp4";
        j.progress = 1;
      },
    });

    expect(listPublicTiktokJob(job).status).toBe("running");

    await vi.waitFor(() => {
      expect(getTiktokJob(job.id).status).toBe("done");
    });

    const pub = listPublicTiktokJob(getTiktokJob(job.id));
    expect(pub.uploadId).toBe("up-1");
    expect(pub.progress).toBe(1);
    expect(registerUpload).toHaveBeenCalled();
  });

  it("cancel stops a running convert", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-job-"));
    const input = path.join(dir, "in.mp4");
    fs.writeFileSync(input, "raw");
    let release;
    const gate = new Promise((r) => {
      release = r;
    });

    const job = createTiktokJob({
      inputPath: input,
      tiktokDir: dir,
      preferredEncoder: "libx264",
      registerUpload: async () => "u",
      runConvert: async (j) => {
        j.proc = { kill: vi.fn() };
        await gate;
      },
    });

    cancelTiktokJob(job.id);
    release();
    await vi.waitFor(() => {
      expect(getTiktokJob(job.id).status).toBe("cancelled");
    });
  });
});
