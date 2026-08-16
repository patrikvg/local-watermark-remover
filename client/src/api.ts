export type Box = { x: number; y: number; width: number; height: number };

export type Health = {
  ok: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  encoder: string;
};

export type UploadResult = {
  id: string;
  filename: string;
  width: number;
  height: number;
  duration: number;
};

export type JobStatus = {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  error: string | null;
  encoder: string;
  outputName: string;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function getHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function uploadVideo(file: File): Promise<UploadResult> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function startProcess(
  uploadId: string,
  box: Box
): Promise<{ jobId: string }> {
  const res = await fetch("/api/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, box }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function cancelJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function downloadUrl(jobId: string): string {
  return `/api/jobs/${jobId}/download`;
}

export type RankingClip = {
  id: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  hasAudio?: boolean;
};

export type RankingBgm = {
  id: string;
  filename: string;
};

export async function uploadRankingClip(file: File): Promise<RankingClip> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/ranking/clips", { method: "POST", body });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function uploadRankingBgm(file: File): Promise<RankingBgm> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/ranking/bgm", { method: "POST", body });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function startRankingExport(body: {
  clipIds: string[];
  title: string;
  titlePos: { x: number; y: number };
  muteClips: boolean;
  bgmId?: string | null;
  bgmVolume: number;
  hasAudio?: boolean[];
}): Promise<{ jobId: string }> {
  const res = await fetch("/api/ranking/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getRankingJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`/api/ranking/jobs/${jobId}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function cancelRankingJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`/api/ranking/jobs/${jobId}/cancel`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function rankingDownloadUrl(jobId: string): string {
  return `/api/ranking/jobs/${jobId}/download`;
}
