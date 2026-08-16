export function safeDownloadFilename(value) {
  const safe = String(value || "video")
    .replace(/[^\x20-\x7E]|[<>:"/\\|?*]/gu, "_")
    .slice(0, 80);
  return safe.toLowerCase().endsWith(".mp4") ? safe : `${safe}.mp4`;
}
