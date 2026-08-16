import { spawn } from "node:child_process";

export function buildProbeArgs(url) {
  return ["-J", "--no-playlist", url];
}

export function buildDownloadArgs({ url, outputTemplate }) {
  return [
    "-f",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--newline",
    "-o",
    outputTemplate,
    url,
  ];
}

export function pickBestResolution(formats) {
  let best = { width: 0, height: 0 };
  for (const f of formats ?? []) {
    const vcodec = f?.vcodec;
    if (!vcodec || vcodec === "none") continue;
    const height = Number(f.height) || 0;
    const width = Number(f.width) || 0;
    if (height > best.height || (height === best.height && width > best.width)) {
      best = { width, height };
    }
  }
  return best;
}

export function labelResolution(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const base = `${w}×${h}`;
  if (h >= 2160 || w >= 3840) return `${base} (4K)`;
  if (h >= 1080 || w >= 1920) return `${base} (Full HD)`;
  if (h >= 720 || w >= 1280) return `${base} (HD)`;
  return base;
}

export function summarizeProbe(json, platform) {
  const { width, height } = pickBestResolution(json?.formats);
  return {
    title: String(json?.title || "Untitled"),
    duration: Number(json?.duration) || 0,
    width,
    height,
    resolutionLabel: labelResolution(width, height),
    platform,
  };
}

export function parseProgressLine(line) {
  const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(String(line));
  if (!m) return null;
  return Math.min(1, Number(m[1]) / 100);
}

export function checkYtdlp(spawnFn = spawn) {
  return new Promise((resolve) => {
    const proc = spawnFn("yt-dlp", ["--version"], { windowsHide: true });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

export function runYtdlp(args, opts = {}) {
  const spawnFn = opts.spawnFn ?? spawn;
  return new Promise((resolve, reject) => {
    const proc = spawnFn("yt-dlp", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      opts.onStderr?.(text);
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const msg =
          stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
          `yt-dlp exited ${code}`;
        reject(new Error(msg));
      }
    });
  });
}

export async function probeUrl(url, platform, opts = {}) {
  const { stdout } = await runYtdlp(buildProbeArgs(url), opts);
  const json = JSON.parse(stdout);
  return summarizeProbe(json, platform);
}
