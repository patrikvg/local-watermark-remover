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
import {
  CANVAS,
  estimateTitleBoxSize,
  centerTitleX,
  centerTitleY,
  toCanvasLen,
  toCanvasPos,
} from "../rankingLayout";

const EMPTY_SLOTS: SlotItem[] = [null, null, null, null, null];
const DEFAULT_CAPTION_WIDTH = 110;

export default function RankingPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotItem[]>(EMPTY_SLOTS);
  const [title, setTitle] = useState("My Top 5");
  const [titlePos, setTitlePos] = useState({ x: 48, y: 72 });
  const [titleBorder, setTitleBorder] = useState(3);
  const [titleWidth, setTitleWidth] = useState(210);
  const [titleWrap, setTitleWrap] = useState(true);
  const [ranksPos, setRanksPos] = useState({ x: 16, y: 160 });
  const stageSizeRef = useRef({ width: 270, height: 480 });
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const [muteClips, setMuteClips] = useState(false);
  const [bgm, setBgm] = useState<RankingBgm | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.25);
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const autoDownloadFor = useRef<string | null>(null);

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
          setMessage("Done — download started.");
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

  useEffect(() => {
    if (job?.status !== "done" || !jobId) return;
    if (autoDownloadFor.current === jobId) return;
    autoDownloadFor.current = jobId;
    const a = document.createElement("a");
    a.href = rankingDownloadUrl(jobId);
    a.download = job.outputName ? `ranking-${job.outputName}` : "ranking.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [job?.status, job?.outputName, jobId]);

  const percent = useMemo(
    () => Math.round((job?.progress ?? 0) * 100),
    [job?.progress]
  );

  async function placeFile(index: number, file: File) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const clip = await uploadRankingClip(file);
      setSlots((prev) => {
        const next = [...prev];
        const old = next[index];
        if (old?.objectUrl) URL.revokeObjectURL(old.objectUrl);
        next[index] = {
          clip,
          objectUrl,
          caption: old?.caption ?? "",
          volume: old?.volume ?? 1,
          wrap: old?.wrap ?? true,
          captionWidth: old?.captionWidth ?? DEFAULT_CAPTION_WIDTH,
        };
        return next;
      });
      return clip.filename;
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      throw err;
    }
  }

  async function onUpload(index: number, file: File) {
    setMessage(null);
    setBusy(true);
    try {
      const name = await placeFile(index, file);
      setMessage(`Slot #${5 - index}: ${name}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onBatchUpload(files: File[]) {
    setMessage(null);
    setBusy(true);
    try {
      const emptyIndexes: number[] = [];
      slots.forEach((s, i) => {
        if (!s) emptyIndexes.push(i);
      });
      const targets =
        emptyIndexes.length > 0
          ? emptyIndexes
          : [0, 1, 2, 3, 4].slice(0, files.length);
      const used = Math.min(files.length, targets.length);
      for (let i = 0; i < used; i++) {
        await placeFile(targets[i], files[i]);
      }
      setMessage(`Loaded ${used} clip(s).`);
    } catch (err) {
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

  function onCaptionChange(index: number, caption: string) {
    setSlots((prev) => {
      const next = [...prev];
      const slot = next[index];
      if (!slot) return prev;
      next[index] = { ...slot, caption };
      return next;
    });
  }

  function onCaptionWrapChange(index: number, wrap: boolean) {
    setSlots((prev) => {
      const next = [...prev];
      const slot = next[index];
      if (!slot) return prev;
      next[index] = { ...slot, wrap };
      return next;
    });
  }

  function onCaptionWidthChange(index: number, captionWidth: number) {
    setSlots((prev) => {
      const next = [...prev];
      const slot = next[index];
      if (!slot) return prev;
      next[index] = { ...slot, captionWidth };
      return next;
    });
  }

  function onClipVolumeChange(index: number, volume: number) {
    setSlots((prev) => {
      const next = [...prev];
      const slot = next[index];
      if (!slot) return prev;
      next[index] = { ...slot, volume };
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
    setBusy(true);
    setMessage("Exporting…");
    setJob(null);
    setJobId(null);
    autoDownloadFor.current = null;
    try {
      const { jobId: id } = await startRankingExport({
        clipIds,
        title: title.trim(),
        titlePos: toCanvasPos(titlePos, width),
        titleBorder,
        titleWidth: toCanvasLen(titleWidth, width),
        titleWrap,
        ranksPos: toCanvasPos(ranksPos, width),
        captions: slots.map((s) => s!.caption),
        captionWidths: slots.map((s) => toCanvasLen(s!.captionWidth, width)),
        captionWraps: slots.map((s) => s!.wrap),
        clipVolumes: slots.map((s) => s!.volume),
        masterVolume,
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

  function onCenterTitle() {
    const { width: stageW, height: stageH } = stageSizeRef.current;
    if (stageW <= 0 || stageH <= 0) return;
    const scale = stageW / CANVAS.width;
    const box = estimateTitleBoxSize(title, titleWidth, titleWrap, scale);
    setTitlePos({
      x: centerTitleX(stageW, box.width),
      y: centerTitleY(stageH, box.height),
    });
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
            <h2 className="section-title">Clips (play order #5 → #1)</h2>
            <p className="hint">
              First slot plays as #5, last as #1. Stack shows #1 on top. Drag
              rows to reorder.
            </p>
            <ClipSlots
              slots={slots}
              onUpload={onUpload}
              onBatchUpload={(files) => void onBatchUpload(files)}
              onReorder={onReorder}
              onCaptionChange={onCaptionChange}
              onCaptionWrapChange={onCaptionWrapChange}
              onClipVolumeChange={onClipVolumeChange}
              disabled={!ready || busy || processing}
            />

            <label className="title-field">
              <span className="section-title">Title</span>
              <textarea
                rows={3}
                value={title}
                disabled={busy || processing}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={"Top 5\nGoals"}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={titleWrap}
                disabled={busy || processing}
                onChange={(e) => setTitleWrap(e.target.checked)}
              />
              Wrap title to next line
            </label>
            <label className="volume-row title-border-row">
              <span>Title black border</span>
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={titleBorder}
                disabled={busy || processing}
                onChange={(e) => setTitleBorder(Number(e.target.value))}
              />
              <span className="time">{titleBorder}px</span>
            </label>

            <button
              type="button"
              disabled={busy || processing}
              onClick={onCenterTitle}
            >
              Mitte
            </button>

            <AudioControls
              muteClips={muteClips}
              onMuteChange={setMuteClips}
              bgmFilename={bgm?.filename ?? null}
              onBgmUpload={onBgmUpload}
              bgmVolume={bgmVolume}
              onVolumeChange={setBgmVolume}
              masterVolume={masterVolume}
              onMasterVolumeChange={setMasterVolume}
              disabled={!ready || busy || processing}
            />
          </div>

          <RankingPreview
            slots={slots}
            title={title}
            titlePos={titlePos}
            onTitlePosChange={setTitlePos}
            titleBorder={titleBorder}
            titleWidth={titleWidth}
            onTitleWidthChange={setTitleWidth}
            titleWrap={titleWrap}
            ranksPos={ranksPos}
            onRanksPosChange={setRanksPos}
            onCaptionWidthChange={onCaptionWidthChange}
            muteClips={muteClips}
            masterVolume={masterVolume}
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
              className="link-btn"
              href={rankingDownloadUrl(jobId)}
              download
            >
              Download again
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
