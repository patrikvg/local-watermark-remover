import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelRankingJob,
  getHealth,
  getRankingJob,
  rankingDownloadUrl,
  startRankingExport,
  uploadRankingBgm,
  uploadRankingClip,
  type Health,
  type JobStatus,
  type RankingBgm,
} from "../api";
import AudioControls from "../components/ranking/AudioControls";
import ClipSlots, { type SlotItem } from "../components/ranking/ClipSlots";
import RankingPreview from "../components/ranking/RankingPreview";

function toCanvasPos(
  pos: { x: number; y: number },
  stageW: number,
  stageH: number
) {
  return {
    x: Math.round((pos.x / stageW) * 1080),
    y: Math.round((pos.y / stageH) * 1920),
  };
}

const EMPTY_SLOTS: SlotItem[] = [null, null, null, null, null];

export default function RankingPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotItem[]>(EMPTY_SLOTS);
  const [title, setTitle] = useState("My Top 5");
  const [titlePos, setTitlePos] = useState({ x: 48, y: 72 });
  const stageSizeRef = useRef({ width: 270, height: 480 });
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const [muteClips, setMuteClips] = useState(false);
  const [bgm, setBgm] = useState<RankingBgm | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.25);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const ready = Boolean(health?.ok);
  const processing = job?.status === "queued" || job?.status === "running";
  const allFilled = slots.every((s) => s != null);
  const audioOk = !muteClips || Boolean(bgm);
  const canExport =
    ready && allFilled && audioOk && Boolean(title.trim()) && !busy && !processing;

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  useEffect(() => {
    return () => {
      for (const slot of slotsRef.current) {
        if (slot?.objectUrl) URL.revokeObjectURL(slot.objectUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!jobId || !processing) return;
    const timer = setInterval(async () => {
      try {
        const next = await getRankingJob(jobId);
        setJob(next);
        if (next.status === "done") {
          setMessage("Done — download your ranking Short.");
          setBusy(false);
        } else if (next.status === "error") {
          setMessage(next.error || "Export failed");
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

  async function onUpload(index: number, file: File) {
    setMessage(null);
    setBusy(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const clip = await uploadRankingClip(file);
      setSlots((prev) => {
        const next = [...prev];
        const old = next[index];
        if (old?.objectUrl) URL.revokeObjectURL(old.objectUrl);
        next[index] = { clip, objectUrl };
        return next;
      });
      setMessage(`Slot #${5 - index}: ${clip.filename}`);
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onReorder(from: number, to: number) {
    setSlots((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function onBgmUpload(file: File) {
    setMessage(null);
    setBusy(true);
    try {
      const result = await uploadRankingBgm(file);
      setBgm(result);
      setMessage(`BGM: ${result.filename}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    if (!allFilled || !audioOk) return;
    const { width, height } = stageSizeRef.current;
    if (!width || !height) {
      setMessage("Preview stage not ready — wait a moment and try again.");
      return;
    }
    const clipIds = slots.map((s) => s!.clip.id);
    const canvasPos = toCanvasPos(titlePos, width, height);
    setBusy(true);
    setMessage("Exporting…");
    setJob(null);
    setJobId(null);
    try {
      const { jobId: id } = await startRankingExport({
        clipIds,
        title: title.trim(),
        titlePos: canvasPos,
        muteClips,
        bgmId: bgm?.id ?? null,
        bgmVolume,
        hasAudio: slots.map((s) => Boolean(s!.clip.hasAudio)),
      });
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
      const next = await cancelRankingJob(jobId);
      setJob(next);
      setBusy(false);
      setMessage("Cancelled");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <header className="hero">
        <h1>Ranking Shorts</h1>
        <p className="subtitle">
          Top 5 clips → one 9:16 Short
          {health?.encoder ? ` · encoder ${health.encoder}` : ""}.
        </p>
      </header>
      {error && (
        <div className="banner danger">
          Cannot reach local API. Start with <code>npm run dev</code>. ({error})
        </div>
      )}
      {health && !health.ok && (
        <div className="banner danger">
          FFmpeg/ffprobe not found on PATH.
        </div>
      )}
      {health?.ok && <div className="banner ok">Local engine ready.</div>}

      <section className="workspace ranking-workspace">
        <div className="ranking-layout">
          <div className="ranking-editor">
            <h2 className="section-title">Clips (rank 5 → 1)</h2>
            <p className="hint">
              First slot is rank #5; last is #1. Drag rows to reorder.
            </p>
            <ClipSlots
              slots={slots}
              onUpload={onUpload}
              onReorder={onReorder}
              disabled={!ready || busy || processing}
            />

            <label className="title-field">
              <span className="section-title">Title</span>
              <input
                type="text"
                value={title}
                disabled={busy || processing}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short title"
              />
            </label>

            <AudioControls
              muteClips={muteClips}
              onMuteChange={setMuteClips}
              bgmFilename={bgm?.filename ?? null}
              onBgmUpload={onBgmUpload}
              bgmVolume={bgmVolume}
              onVolumeChange={setBgmVolume}
              disabled={!ready || busy || processing}
            />
          </div>

          <RankingPreview
            slots={slots}
            title={title}
            titlePos={titlePos}
            onTitlePosChange={setTitlePos}
            muteClips={muteClips}
            stageSizeRef={stageSizeRef}
          />
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!canExport}
            onClick={() => void onExport()}
          >
            Export Short
          </button>
          <button
            type="button"
            disabled={!jobId || !processing}
            onClick={() => void onCancel()}
          >
            Cancel
          </button>
          {job?.status === "done" && jobId && (
            <a
              className="primary link-btn"
              href={rankingDownloadUrl(jobId)}
              download
            >
              Download
            </a>
          )}
        </div>

        {!allFilled && (
          <p className="meta">Upload exactly 5 clips before export.</p>
        )}
        {allFilled && !audioOk && (
          <p className="meta">Add BGM when mute is enabled.</p>
        )}

        {(processing || job?.status === "done") && (
          <div className="progress" aria-live="polite">
            <div className="bar" style={{ width: `${percent}%` }} />
            <span>{percent}%</span>
          </div>
        )}

        {message && <p className="message">{message}</p>}
      </section>
    </>
  );
}
