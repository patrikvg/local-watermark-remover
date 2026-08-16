import { describe, expect, it } from "vitest";
import {
  TITLE_FONT_KEYS,
  resolveTitleFontFile,
  escapeFontfileOption,
} from "../src/titleFonts.js";

describe("titleFonts", () => {
  it("lists the five catalog keys", () => {
    expect(TITLE_FONT_KEYS).toEqual([
      "arial",
      "impact",
      "segoe",
      "georgia",
      "consolas",
    ]);
  });

  it("resolves arial bold to arialbd.ttf on win32 path shape", () => {
    const path = resolveTitleFontFile("arial", "bold", {
      existsSync: (p) => p.replace(/\\/g, "/").endsWith("arialbd.ttf"),
      platform: "win32",
    });
    expect(path.replace(/\\/g, "/")).toMatch(/Windows\/Fonts\/arialbd\.ttf$/i);
  });

  it("falls back to arialbd when chosen file is missing", () => {
    const path = resolveTitleFontFile("georgia", "bold", {
      existsSync: (p) => p.replace(/\\/g, "/").endsWith("arialbd.ttf"),
      platform: "win32",
    });
    expect(path.replace(/\\/g, "/")).toMatch(/arialbd\.ttf$/i);
  });

  it("uses impact.ttf for both weights when present", () => {
    const path = resolveTitleFontFile("impact", "bold", {
      existsSync: (p) => p.replace(/\\/g, "/").toLowerCase().includes("impact.ttf"),
      platform: "win32",
    });
    expect(path.replace(/\\/g, "/").toLowerCase()).toMatch(/impact\.ttf$/);
  });

  it("builds escaped fontfile= option for drawtext", () => {
    const opt = escapeFontfileOption("C:/Windows/Fonts/arialbd.ttf");
    expect(opt).toBe("fontfile='C\\:/Windows/Fonts/arialbd.ttf':");
  });
});
