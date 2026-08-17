import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  parseWorkerFrameLine,
  mapInpaintProgress,
  pythonCandidates,
} from "../src/inpaint.js";

describe("parseWorkerFrameLine", () => {
  it("reads frame i/n", () => {
    expect(parseWorkerFrameLine("frame 3/10")).toEqual({ i: 3, n: 10 });
    expect(parseWorkerFrameLine("noise")).toBeNull();
  });
});

describe("mapInpaintProgress", () => {
  it("maps three phases into 0..1", () => {
    expect(mapInpaintProgress("crop", 0)).toBeCloseTo(0);
    expect(mapInpaintProgress("crop", 1)).toBeCloseTo(0.15);
    expect(mapInpaintProgress("worker", 0)).toBeCloseTo(0.15);
    expect(mapInpaintProgress("worker", 1)).toBeCloseTo(0.8);
    expect(mapInpaintProgress("overlay", 0)).toBeCloseTo(0.8);
    expect(mapInpaintProgress("overlay", 1)).toBeCloseTo(1);
  });
});

describe("pythonCandidates", () => {
  it("prefers INPAINT_PYTHON then venv then python then py -3", () => {
    const root = path.join("C:", "app", "inpaint");
    const list = pythonCandidates(root, {
      INPAINT_PYTHON: "D:\\py.exe",
      venvPython: path.join(root, ".venv", "Scripts", "python.exe"),
    });
    expect(list[0]).toEqual(["D:\\py.exe"]);
    expect(list.some((c) => c[0].includes(".venv"))).toBe(true);
    expect(list.some((c) => c[0] === "python")).toBe(true);
    expect(list.some((c) => c[0] === "py" && c[1] === "-3")).toBe(true);
  });
});
