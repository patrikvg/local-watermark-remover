import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export const uploadsDir = path.join(root, "uploads");
export const outputsDir = path.join(root, "outputs");
export const rankingDir = path.join(root, "ranking");
export const rankingClipsDir = path.join(rankingDir, "clips");
export const rankingBgmDir = path.join(rankingDir, "bgm");

export function ensureDirs() {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.mkdirSync(rankingClipsDir, { recursive: true });
  fs.mkdirSync(rankingBgmDir, { recursive: true });
}
