import { describe, it, expect } from "vitest";
import { fitInpaintRegion } from "../src/inpaintRegion.js";

describe("fitInpaintRegion", () => {
  it("expands a centered box by 24px and keeps the mask on the user box", () => {
    const r = fitInpaintRegion(
      { x: 200, y: 100, width: 80, height: 40 },
      1920,
      1080
    );
    expect(r.crop).toEqual({ x: 176, y: 76, w: 128, h: 88 });
    expect(r.mask).toEqual({ x: 24, y: 24, w: 80, h: 40 });
    expect(r.feather).toEqual({ left: 12, right: 12, top: 12, bottom: 12 });
  });

  it("clamps crop to the frame and shrinks feather on the clamped side", () => {
    const r = fitInpaintRegion(
      { x: 0, y: 0, width: 80, height: 40 },
      1920,
      1080
    );
    expect(r.crop.x).toBeGreaterThanOrEqual(1);
    expect(r.crop.y).toBeGreaterThanOrEqual(1);
    expect(r.crop.x + r.crop.w).toBeLessThanOrEqual(1919);
    expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(1079);
    expect(r.mask.x).toBeGreaterThanOrEqual(0);
    expect(r.mask.y).toBeGreaterThanOrEqual(0);
    expect(r.mask.x + r.mask.w).toBeLessThanOrEqual(r.crop.w);
    expect(r.mask.y + r.mask.h).toBeLessThanOrEqual(r.crop.h);
    expect(r.feather.left).toBeLessThanOrEqual(r.mask.x);
    expect(r.feather.top).toBeLessThanOrEqual(r.mask.y);
  });

  it("keeps a 4K bottom-right TikTok-style box in frame", () => {
    const r = fitInpaintRegion(
      { x: 3600, y: 2100, width: 220, height: 40 },
      3840,
      2160
    );
    expect(r.crop.x + r.crop.w).toBeLessThanOrEqual(3839);
    expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(2159);
    expect(r.crop.w).toBeGreaterThanOrEqual(16);
    expect(r.crop.h).toBeGreaterThanOrEqual(16);
  });

  it("fits a 1080×1920 vertical frame", () => {
    const r = fitInpaintRegion(
      { x: 40, y: 1800, width: 200, height: 80 },
      1080,
      1920
    );
    expect(r.crop.x).toBeGreaterThanOrEqual(1);
    expect(r.crop.y + r.crop.h).toBeLessThanOrEqual(1919);
    expect(r.mask.w).toBeGreaterThanOrEqual(16);
  });
});
