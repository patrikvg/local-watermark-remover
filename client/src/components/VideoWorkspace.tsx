import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelJob,
  downloadUrl,
  getJob,
  startProcess,
  uploadVideo,
  type Box,
  type JobStatus,
  type UploadResult,
} from "../api";
import RegionBox from "./RegionBox";

function getContentRect(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight || !rect.width || !rect.height) {
    return { left: 0, top: 0, width: rect.width, height: rect.height };
  }
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  const left = (rect.width - width) / 2;
  const top = (rect.height - height) / 2;
  return { left, top, width, height };
}

function scaleBoxToVideo(
  box: Box,
  display: { width: number; height: number },
  videoWidth: number,
  videoHeight: number
): Box {
  const sx = videoWidth / display.width;
  const sy = videoHeight / display.height;
  return {
    x: box.x * sx,
    y: box.y * sy,
    width: box.width * sx,
    height: box.height * sy,
  };
}

type Props = {
  ready: boolean;
};

export default function VideoWorkspace({ ready }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [content, setContent] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const processing = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => setContent(getContentRect(video));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(video);
    video.addEventListener("loadedmetadata", update);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", update);
      window.removeEventListener("resize", update);
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!jobId || !processing) return;
    const timer = setInterval(async () => {
      try {
        const next = await getJob(jobId);
        setJob(next);
        if (next.status === "done") {
          setMessage("Done — download your cleaned video.");
          setBusy(false);
        } else if (next.status === "error") {
          setMessage(next.error || "Processing failed");
          setBusy(false);
        } else if (next.status === "cancelled") {
          setMessage("Cancelled");
          setBusy(false);
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [jobId, processing]);

  const percent = useMemo(
    () => Math.round((job?.progress ?? 0) * 100),
    [job?.progress]
  );

  async function onFile(file: File | null) {
    if (!file) return;
    setMessage(null);
    setJob(null);
    setJobId(null);
    setBox(null);
    setUpload(null);
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(URL.createObjectURL(file));
    setBusy(true);
    try {
      const result = await uploadVideo(file);
      setUpload(result);
      setMessage(
        `Loaded ${result.width}×${result.height}. Draw a box over the watermark.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onProcess() {
    if (!upload || !box || !videoRef.current) return;
    const video = videoRef.current;
    const videoBox = scaleBoxToVideo(
      box,
      { width: content.width, height: content.height },
      video.videoWidth || upload.width,
      video.videoHeight || upload.height
    );
    setBusy(true);
    setMessage("Processing…");
    try {
      const { jobId: id } = await startProcess(upload.id, videoBox);
      setJobId(id);
      setJob({
        id,
        status: "queued",
        progress: 0,
        error: null,
        encoder: "",
        outputName: "",
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!jobId) return;
    try {
      const next = await cancelJob(jobId);
      setJob(next);
      setBusy(false);
      setMessage("Cancelled");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="workspace">
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!ready || busy) return;
          void onFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <label className="file-btn">
          <input
            type="file"
            accept="video/*"
            disabled={!ready || busy}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          Choose video
        </label>
        <span className="hint">or drop a file here (4K OK)</span>
      </div>

      {fileUrl && (
        <div className="stage">
          <div className="video-wrap">
            <video ref={videoRef} src={fileUrl} controls playsInline />
            <div
              className="overlay-layer"
              style={{
                left: content.left,
                top: content.top,
                width: content.width,
                height: content.height,
              }}
            >
              <RegionBox
                box={box}
                onChange={setBox}
                disabled={busy || processing || !upload}
              />
            </div>
          </div>
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={!ready || !upload || !box || busy || processing}
          onClick={() => void onProcess()}
        >
          Remove watermark
        </button>
        <button
          type="button"
          disabled={!jobId || !processing}
          onClick={() => void onCancel()}
        >
          Cancel
        </button>
        {job?.status === "done" && jobId && (
          <a className="primary link-btn" href={downloadUrl(jobId)} download>
            Download
          </a>
        )}
      </div>

      {(processing || job?.status === "done") && (
        <div className="progress" aria-live="polite">
          <div className="bar" style={{ width: `${percent}%` }} />
          <span>{percent}%</span>
        </div>
      )}

      {box && (
        <p className="meta">
          Box {Math.round(box.width)}×{Math.round(box.height)}px (display)
        </p>
      )}
      {message && <p className="message">{message}</p>}
    </section>
  );
}
