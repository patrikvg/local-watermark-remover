import { describe, it, expect } from "vitest";
import {
  buildDelogoArgs,
  buildCropExtractArgs,
  buildMaskArgs,
  buildOverlayArgs,
  parseFrameRate,
  overlayAlphaExpr,
} from "../src/ffmpegArgs.js";

describe("buildDelogoArgs", () => {
  it("uses nvenc when requested", () => {
    const args = buildDelogoArgs({
      input: "in.mp4",
      output: "out.mp4",
      delogo: { x: 10, y: 20, w: 100, h: 40, show: 0 },
      encoder: "h264_nvenc",
    });
    expect(args).toContain("-vf");
    expect(args.find((a) => String(a).startsWith("delogo="))).toMatch(
      /x=10:y=20:w=100:h=40/
    );
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
  });

  it("falls back to libx264", () => {
    const args = buildDelogoArgs({
      input: "in.mp4",
      output: "out.mp4",
      delogo: { x: 0, y: 0, w: 32, h: 32, show: 0 },
      encoder: "libx264",
    });
    expect(args).toContain("libx264");
    expect(args).toContain("-preset");
  });
});

describe("parseFrameRate", () => {
  it("parses nt/dt and plain numbers", () => {
    expect(parseFrameRate("30/1")).toBe(30);
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("25")).toBe(25);
    expect(parseFrameRate("nope")).toBe(30);
  });
});

describe("buildCropExtractArgs", () => {
  it("crops to a PNG sequence", () => {
    const args = buildCropExtractArgs({
      input: "in.mp4",
      crop: { x: 10, y: 20, w: 100, h: 40 },
      pattern: "work/crop/frame_%06d.png",
    });
    expect(args).toContain("-i");
    expect(args).toContain("in.mp4");
    expect(args.find((a) => String(a).startsWith("crop="))).toBe(
      "crop=100:40:10:20"
    );
    expect(args.at(-1)).toBe("work/crop/frame_%06d.png");
  });
});

describe("buildMaskArgs", () => {
  it("overlays a white rect on black", () => {
    const args = buildMaskArgs({
      crop: { w: 128, h: 88 },
      mask: { x: 24, y: 24, w: 80, h: 40 },
      output: "work/mask.png",
    });
    expect(args.join(" ")).toMatch(/color=c=black:s=128x88/);
    expect(args.join(" ")).toMatch(/color=c=white:s=80x40/);
    expect(args.find((a) => String(a).includes("overlay="))).toMatch(
      /overlay=24:24/
    );
    expect(args.at(-1)).toBe("work/mask.png");
  });
});

describe("buildOverlayArgs", () => {
  it("uses nvenc and aac", () => {
    const args = buildOverlayArgs({
      input: "in.mp4",
      fillPattern: "work/fill/frame_%06d.png",
      output: "out.mp4",
      crop: { x: 176, y: 76, w: 128, h: 88 },
      feather: { left: 12, right: 12, top: 12, bottom: 12 },
      fps: 30,
      encoder: "h264_nvenc",
    });
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("aac");
    expect(args).toContain("-filter_complex");
    expect(args.join(" ")).toMatch(/overlay=176:76/);
    expect(args).toContain("-framerate");
    expect(args).toContain("30");
    expect(args).toContain("-map");
    expect(args).toContain("[vout]");
    expect(args).toContain("0:a?");
  });

  it("falls back to libx264", () => {
    const args = buildOverlayArgs({
      input: "in.mp4",
      fillPattern: "work/fill/frame_%06d.png",
      output: "out.mp4",
      crop: { x: 1, y: 1, w: 32, h: 32 },
      feather: { left: 0, right: 12, top: 0, bottom: 12 },
      fps: 30,
      encoder: "libx264",
    });
    expect(args).toContain("libx264");
  });
});

describe("overlayAlphaExpr", () => {
  it("avoids divide-by-zero when a side has no feather", () => {
    const expr = overlayAlphaExpr({ left: 0, right: 12, top: 0, bottom: 8 });
    expect(expr).toMatch(/eq\(0,0\)|FL|255/);
    expect(expr).not.toMatch(/\/0/);
    expect(expr).toMatch(/\(W-1-X\)\*255\/12/);
    expect(expr).toMatch(/\(H-1-Y\)\*255\/8/);
  });
});
