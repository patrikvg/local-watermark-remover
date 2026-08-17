import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cancelJob,
  createJobState,
  getJob,
} from "../src/jobs.js";

describe("createJobState + cancelJob", () => {
  it("kills the active child and removes the work dir", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "inpaint-"));
    fs.writeFileSync(path.join(workDir, "x.txt"), "n");
    let killed = false;
    const job = createJobState({
      workDir,
      outputPath: path.join(workDir, "out.mp4"),
      status: "running",
    });
    job.proc = {
      kill() {
        killed = true;
      },
    };
    cancelJob(job.id);
    expect(killed).toBe(true);
    expect(getJob(job.id).status).toBe("cancelled");
    expect(fs.existsSync(workDir)).toBe(false);
  });
});
