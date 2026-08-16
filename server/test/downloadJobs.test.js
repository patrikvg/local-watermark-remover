import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDownloadJob,
  getDownloadJob,
  listPublicDownloadJob,
  cancelDownloadJob,
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

  it("cancel stops a running job", async () => {
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

    cancelDownloadJob(job.id);
    release();
    await vi.waitFor(() => {
      expect(getDownloadJob(job.id).status).toBe("cancelled");
    });
  });
});
