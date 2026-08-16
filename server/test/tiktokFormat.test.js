import { describe, it, expect } from "vitest";
import { buildTiktokFormatArgs } from "../src/tiktokFormat.js";

describe("buildTiktokFormatArgs", () => {
  it("center-crops to 1080x1920 and uses quality nvenc settings", () => {
    const args = buildTiktokFormatArgs({
      input: "C:/in.mp4",
      output: "C:/out.mp4",
      encoder: "h264_nvenc",
    });
    expect(args).toContain("-y");
    expect(args).toContain("C:/in.mp4");
    expect(args).toContain("C:/out.mp4");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(vf).toContain("crop=1080:1920");
    expect(vf).toContain("setsar=1");
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("-cq");
    expect(args).toContain("18");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
  });

  it("uses libx264 crf quality path for software encode", () => {
    const args = buildTiktokFormatArgs({
      input: "C:/in.mp4",
      output: "C:/out.mp4",
      encoder: "libx264",
    });
    expect(args).toContain("libx264");
    expect(args).toContain("-crf");
    expect(args).toContain("17");
    expect(args).toContain("-preset");
    expect(args).toContain("medium");
  });
});
