import { useEffect, useMemo, useRef, useState } from "react";
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
import { triggerBrowserDownload } from "../browserDownload";
import { isSupportedDownloadUrl } from "../downloadUrl";

type Props = {
  onOpenWatermark: (uploadId: string) => void;
};

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

export default function DownloadPage({ onOpenWatermark }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [url, setUrl] = useState("");
  const [probe, setProbe] = useState<DownloadProbe | null>(null);
  const [probedUrl, setProbedUrl] = useState<string | null>(null);
  const [removeWatermark, setRemoveWatermark] = useState(false);
  const [tiktokFormat, setTiktokFormat] = useState(false);
  const [job, setJob] = useState<DownloadJobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const downloadedIds = useRef(new Set<string>());
  const openedWatermarkIds = useRef(new Set<string>());

  const processing = job?.status === "queued" || job?.status === "running";
  const busy = starting || processing;
  const trimmedUrl = url.trim();
  const urlReady = isSupportedDownloadUrl(trimmedUrl);
  const hasCurrentProbe = Boolean(probe && probedUrl && trimmedUrl === probedUrl);
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
    if (!health?.ytdlp || processing || !urlReady) {
      if (!urlReady) {
        setProbe(null);
        setProbedUrl(null);
        setChecking(false);
      }
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        const result = await probeDownload(trimmedUrl, controller.signal);
        setProbe(result);
        setProbedUrl(trimmedUrl);
        setMessage(null);
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return;
        setProbe(null);
        setProbedUrl(null);
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [health?.ytdlp, processing, trimmedUrl, urlReady]);

  useEffect(() => {
    if (!jobId || !processing) return;
    const timer = setInterval(async () => {
      try {
        const next = await getDownloadJob(jobId);
        setJob(next);
        if (next.status === "done") {
          setMessage("Download abgeschlossen.");
          if (!downloadedIds.current.has(jobId)) {
            downloadedIds.current.add(jobId);
            triggerBrowserDownload(downloadFileUrl(jobId));
          }
          if (
            removeWatermark &&
            next.uploadId &&
            !openedWatermarkIds.current.has(jobId)
          ) {
            openedWatermarkIds.current.add(jobId);
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

  async function onDownload() {
    if (!urlReady || busy) return;
    setStarting(true);
    setJob(null);
    setJobId(null);
    setMessage("Download wird gestartet…");
    try {
      const { jobId: id } = await startDownload(trimmedUrl, { tiktokFormat });
      setJobId(id);
      setJob({
        id,
        status: "queued",
        progress: 0,
        error: null,
        outputName: null,
        uploadId: null,
        title: hasCurrentProbe ? probe?.title ?? null : null,
        tiktokFormat,
        phase: null,
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
          YouTube- oder TikTok-URL einfügen — wird live geprüft und direkt
          heruntergeladen.
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
              if (!processing) {
                setJob(null);
                setJobId(null);
                setMessage(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && health?.ytdlp && urlReady && !busy) {
                void onDownload();
              }
            }}
          />
        </label>

        {checking && urlReady && !hasCurrentProbe && (
          <p className="message">Prüfe Video…</p>
        )}

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
            disabled={busy}
            onChange={(event) => setRemoveWatermark(event.target.checked)}
          />
          Danach Watermark entfernen
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={tiktokFormat}
            disabled={busy}
            onChange={(event) => setTiktokFormat(event.target.checked)}
          />
          TikTok-Format (9:16 / 1080×1920)
        </label>

        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!health?.ytdlp || !urlReady || busy}
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
            <a className="link-btn" href={downloadFileUrl(jobId)} download>
              Erneut speichern
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

        {processing && job?.phase === "convert" && (
          <p className="message">Konvertiere zu TikTok-Format…</p>
        )}
        {processing && job?.phase === "download" && (
          <p className="message">Lade herunter…</p>
        )}

        {message && health && <p className="message">{message}</p>}
      </section>
    </>
  );
}
