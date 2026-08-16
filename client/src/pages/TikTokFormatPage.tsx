import { useEffect, useMemo, useState } from "react";
import {
  cancelTiktokJob,
  getHealth,
  getTiktokJob,
  tiktokFileUrl,
  uploadTiktokConvert,
  type Health,
  type TiktokJobStatus,
} from "../api";

type Props = {
  onOpenWatermark: (uploadId: string) => void;
};

type UploadDetails = {
  filename: string;
  width: number;
  height: number;
};

export default function TikTokFormatPage({ onOpenWatermark }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [upload, setUpload] = useState<UploadDetails | null>(null);
  const [removeWatermark, setRemoveWatermark] = useState(false);
  const [job, setJob] = useState<TiktokJobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const processing = job?.status === "queued" || job?.status === "running";
  const busy = uploading || processing;
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
        const next = await getTiktokJob(jobId);
        setJob(next);
        if (next.status === "done") {
          setMessage("Konvertierung abgeschlossen.");
          if (removeWatermark && next.uploadId) {
            onOpenWatermark(next.uploadId);
          }
        } else if (next.status === "error") {
          setMessage(next.error || "Konvertierung fehlgeschlagen.");
        } else if (next.status === "cancelled") {
          setMessage("Konvertierung abgebrochen.");
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [jobId, onOpenWatermark, processing, removeWatermark]);

  async function onFile(file: File | null) {
    if (!file || !health?.ok || busy) return;
    setUploading(true);
    setUpload(null);
    setJob(null);
    setJobId(null);
    setMessage("Video wird hochgeladen…");
    try {
      const result = await uploadTiktokConvert(file);
      setUpload({
        filename: result.filename,
        width: result.width,
        height: result.height,
      });
      setJobId(result.jobId);
      setJob({
        id: result.jobId,
        status: "queued",
        progress: 0,
        error: null,
        outputName: null,
        uploadId: null,
        filename: result.filename,
      });
      setMessage("Konvertierung wird gestartet…");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function onCancel() {
    if (!jobId) return;
    try {
      const next = await cancelTiktokJob(jobId);
      setJob(next);
      setMessage("Konvertierung abgebrochen.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="hero">
        <h1>TikTok-Format</h1>
        <p className="subtitle">
          Lokales Video in das TikTok-Format 9:16 / 1080×1920 konvertieren.
        </p>
      </header>

      {message && !health && (
        <div className="banner danger">
          Cannot reach local API. Start with <code>npm run dev</code>. ({message})
        </div>
      )}
      {health && !health.ok && (
        <div className="banner danger">
          FFmpeg or ffprobe not found on PATH. Install FFmpeg and restart the
          app.
        </div>
      )}

      <section className="workspace">
        <div
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!health?.ok || busy) return;
            void onFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <label className="file-btn">
            <input
              type="file"
              accept="video/*"
              disabled={!health?.ok || busy}
              onChange={(event) =>
                void onFile(event.target.files?.[0] ?? null)
              }
            />
            Video auswählen
          </label>
          <span className="hint">oder Datei hier ablegen</span>
        </div>

        {upload && (
          <div className="banner">
            <strong>{upload.filename}</strong>
            <p className="meta">
              {upload.width}×{upload.height}
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

        <div className="actions">
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
              href={tiktokFileUrl(jobId)}
              download
            >
              Datei speichern
            </a>
          )}
          {job?.status === "done" && job.uploadId && (
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
