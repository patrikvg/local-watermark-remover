import { useEffect, useMemo, useState } from "react";
import {
  cancelDownloadJob,
  downloadFileUrl,
  getDownloadJob,
  getHealth,
  probeDownload,
  startDownload,
  type DownloadJobStatus,
  type DownloadProbe,
  type Health,
} from "../api";

type Props = {
  onOpenWatermark: (uploadId: string) => void;
};

export default function DownloadPage({ onOpenWatermark }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<DownloadProbe | null>(null);
  const [probedUrl, setProbedUrl] = useState<string | null>(null);
  const [removeWatermark, setRemoveWatermark] = useState(false);
  const [job, setJob] = useState<DownloadJobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const processing = job?.status === "queued" || job?.status === "running";
  const hasCurrentProbe = Boolean(
    probe && probedUrl && url.trim() === probedUrl
  );
  const percent = useMemo(
    () => Math.round((job?.progress ?? 0) * 100),
    [job?.progress]
  );

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((err) =>
        setMessage(err instanceof Error ? err.message : String(err))
      );
  }, []);

  useEffect(() => {
    if (!jobId || !processing) return;
    const timer = setInterval(async () => {
      try {
        const next = await getDownloadJob(jobId);
        setJob(next);
        if (next.status === "done") {
          setMessage("Download abgeschlossen.");
          if (removeWatermark && next.uploadId) {
            onOpenWatermark(next.uploadId);
          }
        } else if (next.status === "error") {
          setMessage(next.error || "Download fehlgeschlagen.");
        } else if (next.status === "cancelled") {
          setMessage("Download abgebrochen.");
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [jobId, onOpenWatermark, processing, removeWatermark]);

  async function onProbe() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setChecking(true);
    setProbe(null);
    setProbedUrl(null);
    setJob(null);
    setJobId(null);
    setMessage(null);
    try {
      const result = await probeDownload(trimmed);
      setProbe(result);
      setProbedUrl(trimmed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function onDownload() {
    if (!probe || !probedUrl || url.trim() !== probedUrl) return;
    setStarting(true);
    setJob(null);
    setJobId(null);
    setMessage("Download wird gestartet…");
    try {
      const { jobId: id } = await startDownload(probedUrl);
      setJobId(id);
      setJob({
        id,
        status: "queued",
        progress: 0,
        error: null,
        outputName: null,
        uploadId: null,
        title: probe.title,
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function onCancel() {
    if (!jobId) return;
    try {
      const next = await cancelDownloadJob(jobId);
      setJob(next);
      setMessage("Download abgebrochen.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="hero">
        <h1>Video herunterladen</h1>
        <p className="subtitle">
          YouTube- oder TikTok-URL prüfen und in bester Qualität herunterladen.
        </p>
      </header>

      {message && !health && (
        <div className="banner danger">
          Cannot reach local API. Start with <code>npm run dev</code>. ({message})
        </div>
      )}
      {health?.ytdlp === false && (
        <div className="banner danger">
          yt-dlp not found on PATH. Install yt-dlp and restart the app.
        </div>
      )}
      {health?.ytdlp && (
        <div className="banner ok">yt-dlp is ready.</div>
      )}

      <section className="workspace">
        <label className="title-field">
          <span>Video-URL</span>
          <input
            type="text"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            disabled={processing}
            onChange={(event) => {
              setUrl(event.target.value);
              setProbe(null);
              setProbedUrl(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && health?.ytdlp && !checking) {
                void onProbe();
              }
            }}
          />
        </label>

        <div className="actions">
          <button
            type="button"
            disabled={!health?.ytdlp || !url.trim() || checking || processing}
            onClick={() => void onProbe()}
          >
            {checking ? "Prüfe…" : "Prüfen"}
          </button>
        </div>

        {probe && hasCurrentProbe && (
          <div className="banner">
            <strong>{probe.title}</strong>
            <p className="meta">
              {probe.platform === "youtube" ? "YouTube" : "TikTok"} ·{" "}
              {probe.resolutionLabel} · {probe.duration.toFixed(1)} s
            </p>
          </div>
        )}

        <label className="check-row">
          <input
            type="checkbox"
            checked={removeWatermark}
            disabled={processing}
            onChange={(event) => setRemoveWatermark(event.target.checked)}
          />
          Danach Watermark entfernen
        </label>

        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={
              !health?.ytdlp ||
              !hasCurrentProbe ||
              checking ||
              starting ||
              processing
            }
            onClick={() => void onDownload()}
          >
            {starting ? "Starte…" : "Herunterladen"}
          </button>
          <button
            type="button"
            disabled={!jobId || !processing}
            onClick={() => void onCancel()}
          >
            Abbrechen
          </button>
          {job?.status === "done" && jobId && (
            <a
              className="primary link-btn"
              href={downloadFileUrl(jobId)}
              download
            >
              Datei speichern
            </a>
          )}
          {job?.uploadId && (
            <button
              type="button"
              onClick={() => onOpenWatermark(job.uploadId!)}
            >
              Zu Watermark
            </button>
          )}
        </div>

        {(processing || job?.status === "done") && (
          <div className="progress" aria-live="polite">
            <div className="bar" style={{ width: `${percent}%` }} />
            <span>{percent}%</span>
          </div>
        )}

        {message && health && <p className="message">{message}</p>}
      </section>
    </>
  );
}
