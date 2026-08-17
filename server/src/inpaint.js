import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const inpaintRoot = path.resolve(__dirname, "../inpaint");
export const workerPath = path.join(inpaintRoot, "worker.py");

export function parseWorkerFrameLine(text) {
  const m = /frame\s+(\d+)\s*\/\s*(\d+)/i.exec(String(text));
  if (!m) return null;
  const i = Number(m[1]);
  const n = Number(m[2]);
  if (!n) return null;
  return { i, n };
}

export function mapInpaintProgress(phase, fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  if (phase === "crop") return 0.15 * f;
  if (phase === "worker") return 0.15 + 0.65 * f;
  if (phase === "overlay") return 0.8 + 0.2 * f;
  return f;
}

export function pythonCandidates(root, opts = {}) {
  const envPython = opts.INPAINT_PYTHON ?? process.env.INPAINT_PYTHON;
  const venvPython =
    opts.venvPython ??
    (process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python"));
  const list = [];
  if (envPython) list.push([envPython]);
  list.push([venvPython]);
  list.push(["python"]);
  list.push(["py", "-3"]);
  return list;
}

function runOnce(cmd, cmdArgs, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, cmdArgs, { windowsHide: true });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, error: e.message });
    });
    proc.on("close", (code) => {
      clearTimeout(t);
      const line = out.trim().split("\n").filter(Boolean).at(-1) || "";
      try {
        const json = JSON.parse(line);
        resolve({
          ok: Boolean(json.ok) && code === 0,
          device: json.device ?? null,
          error: json.error || (code === 0 ? null : err.slice(-200)),
        });
      } catch {
        resolve({
          ok: false,
          device: null,
          error: err.slice(-200) || `exit ${code}`,
        });
      }
    });
  });
}

export async function checkInpaint() {
  if (!fs.existsSync(workerPath)) {
    return { ok: false, device: null, error: "worker.py missing" };
  }
  for (const cand of pythonCandidates(inpaintRoot)) {
    const [cmd, ...pre] = cand;
    if (cmd.includes(".venv") && !fs.existsSync(cmd)) continue;
    const result = await runOnce(
      cmd,
      [...pre, workerPath, "--check"],
      20000
    );
    if (result.ok) {
      return { ...result, python: cand };
    }
  }
  return {
    ok: false,
    device: null,
    python: null,
    error:
      "Inpaint engine not ready. In server/inpaint create a venv, install CUDA torch, pip install -r requirements.txt, then python worker.py --check.",
  };
}

export function spawnWorker({ python, inputDir, mask, outputDir }) {
  const [cmd, ...pre] = python;
  return spawn(
    cmd,
    [
      ...pre,
      workerPath,
      "--input-dir",
      inputDir,
      "--mask",
      mask,
      "--output-dir",
      outputDir,
    ],
    { windowsHide: true }
  );
}
