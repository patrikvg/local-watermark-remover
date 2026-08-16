import { describe, it, expect } from "vitest";
import { buildDelogoArgs } from "../src/ffmpegArgs.js";

describe("buildDelogoArgs", () => {
  it("uses nvenc when requested", () => {
    const args = buildDelogoArgs({
      input: "in.mp4",
      output: "out.mp4",
      delogo: { x: 10, y: 20, w: 100, h: 40, band: 8, show: 1 },
      encoder: "h264_nvenc",
    });
    expect(args).toContain("-vf");
    expect(args.find((a) => String(a).startsWith("delogo="))).toMatch(
      /x=10:y=20:w=100:h=40/
    );
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("-c:a");
    expect(args).toContain("copy");
  });

  it("falls back to libx264", () => {
    const args = buildDelogoArgs({
      input: "in.mp4",
      output: "out.mp4",
      delogo: { x: 0, y: 0, w: 32, h: 32, band: 4, show: 1 },
      encoder: "libx264",
    });
    expect(args).toContain("libx264");
    expect(args).toContain("-preset");
  });
});
