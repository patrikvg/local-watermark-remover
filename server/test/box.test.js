import { describe, it, expect } from "vitest";
import { normalizeBox, toDelogoParams } from "../src/box.js";

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
});

describe("toDelogoParams", () => {
  it("maps box to even integers and expands edges", () => {
    const p = toDelogoParams({ x: 101, y: 51, width: 120, height: 40 }, 8);
    expect(p).toEqual({ x: 92, y: 42, w: 136, h: 56, show: 0 });
  });
});
