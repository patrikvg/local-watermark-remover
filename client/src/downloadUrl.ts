export function isSupportedDownloadUrl(raw: string): boolean {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const isYoutubeCom = host === "youtube.com" || host.endsWith(".youtube.com");
  if (
    isYoutubeCom ||
    host === "youtu.be" ||
    host.endsWith(".youtu.be")
  ) {
    if (isYoutubeCom && /^\/(?:playlist|channel|user)(?:\/|$)/i.test(parsed.pathname)) {
      return false;
    }
    return true;
  }

  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}
