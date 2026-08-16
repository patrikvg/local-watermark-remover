/**
 * @param {string} raw
 * @returns {{ ok: true, url: string, platform: "youtube" | "tiktok" } | { ok: false, error: string }}
 */
export function parseDownloadUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "URL is required" };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Invalid URL" };
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  const youtubeHosts = new Set([
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);
  if (
    youtubeHosts.has(host) ||
    host.endsWith(".youtube.com") ||
    host.endsWith(".youtu.be")
  ) {
    return { ok: true, url: parsed.toString(), platform: "youtube" };
  }

  const tiktokHosts = new Set(["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]);
  if (tiktokHosts.has(host) || host.endsWith(".tiktok.com")) {
    return { ok: true, url: parsed.toString(), platform: "tiktok" };
  }

  return {
    ok: false,
    error: "Only YouTube and TikTok URLs are supported",
  };
}
