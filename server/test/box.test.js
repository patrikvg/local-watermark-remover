import { describe, it, expect } from "vitest";
import {
  normalizeBox,
  fitDelogoRegion,
  scaleBoxFromDisplay,
  formatFfmpegError,
} from "../src/box.js";

describe("normalizeBox", () => {
  it("clamps to frame and enforces min size", () => {
    expect(
      normalizeBox({ x: -10, y: -5, width: 2, height: 2 }, 1920, 1080)
    ).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });

  it("rejects empty video size", () => {
    expect(() =>
      normalizeBox({ x: 0, y: 0, width: 40, height: 40 }, 0, 1080)
    ).toThrow(/video size/i);
  });

  it("keeps bottom-right boxes inside 4K frame", () => {
    const box = normalizeBox(
      { x: 3600, y: 2100, width: 230 * (3840 / 1100), height: 42 * (2160 / 618) },
      3840,
      2160
    );
    expect(box.x + box.width).toBeLessThanOrEqual(3840);
    expect(box.y + box.height).toBeLessThanOrEqual(2160);
  });
});

describe("fitDelogoRegion", () => {
  it("expands inward near bottom-right so delogo stays in frame", () => {
    const d = fitDelogoRegion(
      { x: 3600, y: 2110, width: 220, height: 40 },
      3840,
      2160,
      8
    );
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.x + d.w).toBeLessThanOrEqual(3840);
    expect(d.y + d.h).toBeLessThanOrEqual(2160);
    expect(d.w).toBeGreaterThanOrEqual(2);
    expect(d.h).toBeGreaterThanOrEqual(2);
  });

  it("handles a box flush with the bottom-right corner", () => {
    const d = fitDelogoRegion(
      { x: 3840 - 230, y: 2160 - 42, width: 230, height: 42 },
      3840,
      2160,
      8
    );
    expect(d.x).toBeGreaterThanOrEqual(1);
    expect(d.y).toBeGreaterThanOrEqual(1);
    expect(d.x + d.w).toBeLessThanOrEqual(3839);
    expect(d.y + d.h).toBeLessThanOrEqual(2159);
  });
});

describe("scaleBoxFromDisplay", () => {
  it("maps a bottom-right display box into 4K pixels", () => {
    const displayW = 1100;
    const displayH = 618.75;
    const box = scaleBoxFromDisplay(
      { x: displayW - 230, y: displayH - 42, width: 230, height: 42 },
      displayW,
      displayH,
      3840,
      2160
    );
    expect(box.x + box.width).toBeLessThanOrEqual(3840);
    expect(box.y + box.height).toBeLessThanOrEqual(2160);
    expect(box.y).toBeGreaterThan(2000);
  });
});

describe("formatFfmpegError", () => {
  it("explains outside-frame delogo failures", () => {
    expect(
      formatFfmpegError("Logo area is outside of the frame.\nConversion failed!")
    ).toMatch(/outside the video frame/i);
  });
});
