import fs from "node:fs";
import path from "node:path";

export const TITLE_FONT_KEYS = [
  "arial",
  "impact",
  "segoe",
  "georgia",
  "consolas",
];

const WIN_FONTS = "C:/Windows/Fonts";

/** @type {Record<string, { regular: string, bold: string }>} */
const FILES = {
  arial: { regular: "arial.ttf", bold: "arialbd.ttf" },
  impact: { regular: "impact.ttf", bold: "impact.ttf" },
  segoe: { regular: "segoeui.ttf", bold: "segoeuib.ttf" },
  georgia: { regular: "georgia.ttf", bold: "georgiab.ttf" },
  consolas: { regular: "consola.ttf", bold: "consolab.ttf" },
};

const FALLBACK = path.join(WIN_FONTS, "arialbd.ttf");

/**
 * @param {string} fontKey
 * @param {"regular"|"bold"} weight
 * @param {{ existsSync?: (p: string) => boolean, platform?: string }} [deps]
 */
export function resolveTitleFontFile(fontKey, weight, deps = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  const platform = deps.platform || process.platform;
  if (platform !== "win32") {
    return FALLBACK;
  }
  const key = TITLE_FONT_KEYS.includes(fontKey) ? fontKey : "arial";
  const w = weight === "regular" ? "regular" : "bold";
  const file = FILES[key][w];
  const full = path.join(WIN_FONTS, file);
  if (existsSync(full)) return full;
  if (existsSync(FALLBACK)) return FALLBACK;
  return full;
}

export function escapeFontfileOption(absolutePath) {
  const escaped = String(absolutePath).replace(/\\/g, "/").replace(/:/g, "\\:");
  return `fontfile='${escaped}':`;
}
