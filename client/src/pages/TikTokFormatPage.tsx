import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTiktokJob,
  getHealth,
  getTiktokJob,
  tiktokFileUrl,
  uploadTiktokConvert,
  type Health,
  type TiktokJobStatus,
} from "../api";
import { triggerBrowserDownload } from "../browserDownload";

type Props = {
  onOpenWatermark: (uploadId: string) => void;
};

type QueueItem = {
  localId: string;
  filename: string;
  width: number | null;
  height: number | null;
  jobId: string | null;
  job: TiktokJobStatus | null;
  uploading: boolean;
  error: string | null;
};

function takeVideoFiles(list: FileList | File[] | null): File[] {
  if (!list) return [];
  return Array.from(list).filter(
    (file) =>
      file.type.startsWith("video/") ||
      /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name)
  );
}

function isProcessing(item: QueueItem) {
  return (
    item.uploading ||
    item.job?.status === "queued" ||
    item.job?.status === "running"
  );
}

function statusLabel(item: QueueItem) {
  if (item.uploading) return "Hochladen…";
  if (item.error) return item.error;
  if (item.job?.status === "queued") return "In Warteschlange…";
  if (item.job?.status === "running") return "Konvertiere…";
  if (item.job?.status === "done") return "Fertig";
  if (item.job?.status === "error") {
    return item.job.error || "Konvertierung fehlgeschlagen.";
  }
  if (item.job?.status === "cancelled") return "Abgebrochen";
  return "";
}

export default function TikTokFormatPage({ onOpenWatermark }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [removeWatermark, setRemoveWatermark] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const itemsRef = useRef(items);
  const downloadedIds = useRef(new Set<string>());
  const openedWatermarkIds = useRef(new Set<string>());
  const uploadControllers = useRef(new Map<string, AbortController>());

  itemsRef.current = items;

  const processingCount = items.filter(isProcessing).length;
  const processingIds = items
    .filter((item) => item.jobId && isProcessing(item) && !item.uploading)
    .map((item) => item.jobId!)
    .join(",");

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((err) =>
        setMessage(err instanceof Error ? err.message : String(err))
      );
  }, []);

  useEffect(() => {
    if (!processingIds) return;
    const jobIds = processingIds.split(",");
    const timer = setInterval(async () => {
      const updates = await Promise.all(
        jobIds.map(async (jobId) => {
          try {
            return { jobId, job: await getTiktokJob(jobId), error: null };
          } catch (err) {
            return {
              jobId,
              job: null as TiktokJobStatus | null,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      let delay = 0;
      for (const update of updates) {
        if (
          update.job?.status === "done" &&
          !downloadedIds.current.has(update.job.id)
        ) {
          downloadedIds.current.add(update.job.id);
          const href = tiktokFileUrl(update.job.id);
          window.setTimeout(() => triggerBrowserDownload(href), delay);
          delay += 400;

          if (
            removeWatermark &&
            update.job.uploadId &&
            itemsRef.current.length === 1 &&
            !openedWatermarkIds.current.has(update.job.id)
          ) {
            openedWatermarkIds.current.add(update.job.id);
            onOpenWatermark(update.job.uploadId);
          }
        }
      }

      setItems((prev) =>
        prev.map((item) => {
          const update = updates.find((entry) => entry.jobId === item.jobId);
          if (!update) return item;
          return {
            ...item,
            job: update.job ?? item.job,
            error: update.error ?? item.error,
          };
        })
      );

      const failed = updates.find((entry) => entry.job?.status === "error");
      if (failed?.job?.error) {
        setMessage(failed.job.error);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [onOpenWatermark, processingIds, removeWatermark]);

  async function enqueueFiles(files: File[]) {
    if (!health?.ok || !files.length) return;
    const nextItems: QueueItem[] = files.map((file) => ({
      localId: crypto.randomUUID(),
      filename: file.name,
      width: null,
      height: null,
      jobId: null,
      job: null,
      uploading: true,
      error: null,
    }));
    setItems((prev) => [...prev, ...nextItems]);
    setMessage(
      files.length === 1
        ? "Video wird hochgeladen…"
        : `${files.length} Videos werden hochgeladen…`
    );

    await Promise.all(
      nextItems.map(async (item, index) => {
        const controller = new AbortController();
        uploadControllers.current.set(item.localId, controller);
        try {
          const result = await uploadTiktokConvert(files[index], controller.signal);
          setItems((prev) =>
            prev.map((entry) =>
              entry.localId === item.localId
                ? {
                    ...entry,
                    filename: result.filename,
                    width: result.width,
                    height: result.height,
                    jobId: result.jobId,
                    uploading: false,
                    job: {
                      id: result.jobId,
                      status: "queued",
                      progress: 0,
                      error: null,
                      outputName: null,
                      uploadId: null,
                      filename: result.filename,
                    },
                  }
                : entry
            )
          );
        } catch (err) {
          const aborted =
            (err instanceof DOMException && err.name === "AbortError") ||
            controller.signal.aborted;
          const error = aborted
            ? "Abgebrochen"
            : err instanceof Error
              ? err.message
              : String(err);
          setItems((prev) =>
            prev.map((entry) =>
              entry.localId === item.localId
                ? { ...entry, uploading: false, error }
                : entry
            )
          );
          if (!aborted) setMessage(error);
        } finally {
          uploadControllers.current.delete(item.localId);
        }
      })
    );
  }

  async function onCancelItem(item: QueueItem) {
    const controller = uploadControllers.current.get(item.localId);
    if (controller) controller.abort();
    if (!item.jobId) {
      setItems((prev) =>
        prev.map((entry) =>
          entry.localId === item.localId
            ? { ...entry, uploading: false, error: "Abgebrochen" }
            : entry
        )
      );
      return;
    }
    try {
      const next = await cancelTiktokJob(item.jobId);
      setItems((prev) =>
        prev.map((entry) =>
          entry.localId === item.localId ? { ...entry, job: next } : entry
        )
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function onCancelAll() {
    for (const controller of uploadControllers.current.values()) {
      controller.abort();
    }
    const active = items.filter((item) => item.jobId && isProcessing(item));
    await Promise.all(active.map((item) => onCancelItem(item)));
    if (processingCount > 0) setMessage("Konvertierung abgebrochen.");
  }

  const summary = useMemo(() => {
    if (!items.length) return null;
    const done = items.filter((item) => item.job?.status === "done").length;
    if (processingCount > 0) {
      return `${done}/${items.length} fertig — ${processingCount} in Bearbeitung`;
    }
    return `${done}/${items.length} konvertiert`;
  }, [items, processingCount]);

  return (
    <>
      <header className="hero">
        <h1>TikTok-Format</h1>
        <p className="subtitle">
          Mehrere lokale Videos gleichzeitig in 9:16 / 1080×1920 konvertieren.
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
          className={"dropzone" + (dragOver ? " is-drag-over" : "")}
          onDragOver={(event) => {
            event.preventDefault();
            if (health?.ok) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (!health?.ok) return;
            void enqueueFiles(takeVideoFiles(event.dataTransfer.files));
          }}
        >
          <label className="file-btn">
            <input
              type="file"
              accept="video/*"
              multiple
              disabled={!health?.ok}
              onChange={(event) => {
                const files = takeVideoFiles(event.target.files);
                event.target.value = "";
                void enqueueFiles(files);
              }}
            />
            Videos auswählen
          </label>
          <span className="hint">oder mehrere Dateien hier ablegen</span>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={removeWatermark}
            disabled={processingCount > 0}
            onChange={(event) => setRemoveWatermark(event.target.checked)}
          />
          Danach Watermark entfernen
        </label>

        {items.length > 0 && (
          <div className="actions">
            <button
              type="button"
              disabled={processingCount === 0}
              onClick={() => void onCancelAll()}
            >
              Alle abbrechen
            </button>
          </div>
        )}

        {items.length > 0 && (
          <ul className="job-list">
            {items.map((item) => {
              const percent = Math.round((item.job?.progress ?? 0) * 100);
              const showProgress =
                item.uploading ||
                item.job?.status === "queued" ||
                item.job?.status === "running" ||
                item.job?.status === "done";
              return (
                <li key={item.localId} className="job-card">
                  <div className="job-card-head">
                    <div>
                      <strong>{item.filename}</strong>
                      {item.width && item.height ? (
                        <p className="meta">
                          {item.width}×{item.height}
                        </p>
                      ) : null}
                    </div>
                    <span className="job-status">{statusLabel(item)}</span>
                  </div>
                  {showProgress && (
                    <div className="progress" aria-live="polite">
                      <div className="bar" style={{ width: `${percent}%` }} />
                      <span>{percent}%</span>
                    </div>
                  )}
                  <div className="actions">
                    <button
                      type="button"
                      disabled={!isProcessing(item)}
                      onClick={() => void onCancelItem(item)}
                    >
                      Abbrechen
                    </button>
                    {item.job?.status === "done" && item.jobId && (
                      <a
                        className="link-btn"
                        href={tiktokFileUrl(item.jobId)}
                        download
                      >
                        Erneut speichern
                      </a>
                    )}
                    {item.job?.status === "done" && item.job.uploadId && (
                      <button
                        type="button"
                        onClick={() => onOpenWatermark(item.job!.uploadId!)}
                      >
                        Zu Watermark
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {summary && <p className="message">{summary}</p>}
        {message && health && <p className="message">{message}</p>}
      </section>
    </>
  );
}
