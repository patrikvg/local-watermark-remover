import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import TitleOverlay from "./TitleOverlay";
import type { SlotItem } from "./ClipSlots";
import {
  CANVAS,
  CAPTION_LINE_SPACING,
  CAPTION_X_RATIO,
  RANK_FONT,
  RANK_LINE_HEIGHT,
  captionFontSize,
  centerAlong,
  overlayTextHeight,
  wrapOverlayText,
} from "../../rankingLayout";

type Props = {
  slots: SlotItem[];
  title: string;
  titlePos: { x: number; y: number };
  onTitlePosChange: (pos: { x: number; y: number }) => void;
  titleBorder: number;
  titleWidth: number;
  onTitleWidthChange: (width: number) => void;
  titleWrap: boolean;
  ranksPos: { x: number; y: number };
  onRanksPosChange: (pos: { x: number; y: number }) => void;
  onCaptionWidthChange: (index: number, width: number) => void;
  muteClips: boolean;
  masterVolume: number;
  stageSizeRef: MutableRefObject<{ width: number; height: number }>;
};

function rankForIndex(index: number) {
  return 5 - index;
}

function rankTone(rank: number) {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "";
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const MIN_CAPTION_W = 40;
const ALL_RANKS = [1, 2, 3, 4, 5] as const;

export default function RankingPreview({
  slots,
  title,
  titlePos,
  onTitlePosChange,
  titleBorder,
  titleWidth,
  onTitleWidthChange,
  titleWrap,
  ranksPos,
  onRanksPosChange,
  onCaptionWidthChange,
  muteClips,
  masterVolume,
  stageSizeRef,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);
  const [stageW, setStageW] = useState(270);
  const [timeline, setTimeline] = useState(0);
  const draggingRanks = useRef(false);
  const resizingCaption = useRef<number | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const scrubbing = useRef(false);
  const idleTimer = useRef<number | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const ranksOrigin = useRef({
    pointerX: 0,
    pointerY: 0,
    startX: 0,
    startY: 0,
    startW: 0,
  });

  function bumpChrome() {
    setChromeVisible(true);
    if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (!scrubbing.current) setChromeVisible(false);
    }, 2000);
  }

  const urls = useMemo(
    () => slots.map((s) => s?.objectUrl ?? null),
    [slots]
  );
  const urlsKey = urls.map((u) => u ?? "").join("\0");
  const playable = urls.every(Boolean);
  const currentSrc = urls[clipIndex] ?? null;
  const currentVolume = slots[clipIndex]?.volume ?? 1;

  const durations = useMemo(
    () => slots.map((s) => (s && s.clip.duration > 0 ? s.clip.duration : 0)),
    [slots]
  );
  const starts = useMemo(() => {
    const out = [0, 0, 0, 0, 0];
    let t = 0;
    for (let i = 0; i < 5; i++) {
      out[i] = t;
      t += durations[i];
    }
    return out;
  }, [durations]);
  const totalDuration = starts[4] + durations[4];

  const newestRank = playable ? rankForIndex(clipIndex) : null;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const report = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      stageSizeRef.current = { width, height };
      setStageW(width);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageSizeRef]);

  useEffect(() => {
    setClipIndex(0);
    setPlaying(false);
    setTimeline(0);
    pendingSeek.current = 0;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  }, [urlsKey]);

  useEffect(() => {
    return () => {
      if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => {
    if (playable) bumpChrome();
  }, [playable]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !currentSrc) return;
    v.muted = muteClips;
    v.volume = Math.max(0, Math.min(1, currentVolume * masterVolume));
    const applySeek = () => {
      if (pendingSeek.current != null) {
        const d = Number.isFinite(v.duration) ? v.duration : Infinity;
        v.currentTime = Math.max(0, Math.min(pendingSeek.current, Math.max(0, d - 0.05)));
        pendingSeek.current = null;
      }
      if (playing) {
        void v.play().catch(() => setPlaying(false));
      }
    };
    if (v.readyState >= 2) applySeek();
    else v.addEventListener("loadeddata", applySeek, { once: true });
    return () => v.removeEventListener("loadeddata", applySeek);
  }, [currentSrc, muteClips, playing, currentVolume, masterVolume]);

  function onPlayPause() {
    if (!playable) return;
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    void v.play().catch(() => setPlaying(false));
  }

  function onEnded() {
    if (clipIndex < 4) {
      pendingSeek.current = 0;
      setClipIndex((i) => i + 1);
      return;
    }
    setPlaying(false);
    pendingSeek.current = 0;
    setClipIndex(0);
    setTimeline(0);
  }

  function onTimeUpdate() {
    if (scrubbing.current) return;
    const v = videoRef.current;
    if (!v) return;
    setTimeline(starts[clipIndex] + v.currentTime);
  }

  function seekTo(time: number) {
    if (!playable || totalDuration <= 0) return;
    const t = Math.max(0, Math.min(totalDuration, time));
    setTimeline(t);
    let acc = 0;
    for (let i = 0; i < 5; i++) {
      const d = durations[i];
      const last = i === 4;
      if (t < acc + d || last) {
        const offset = Math.max(0, t - acc);
        if (i === clipIndex) {
          const v = videoRef.current;
          if (v) v.currentTime = offset;
          pendingSeek.current = null;
        } else {
          pendingSeek.current = offset;
          setClipIndex(i);
        }
        return;
      }
      acc += d;
    }
  }

  const scale = Math.max(0.05, stageW / CANVAS.width);
  const capSize = captionFontSize(RANK_FONT);

  return (
    <section className="ranking-preview">
      <h2 className="section-title">Preview (9:16)</h2>
      <p className="hint">
        Drag the boxes to move. Drag the right edge to set wrap width.
      </p>
      <div className="ranking-stage-wrap">
        <div
          ref={stageRef}
          className="ranking-stage"
          onPointerMove={() => bumpChrome()}
          onPointerDown={() => bumpChrome()}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (
              t.closest(".ranking-title") ||
              t.closest(".ranking-rank-stack") ||
              t.closest(".ranking-transport-overlay")
            ) {
              return;
            }
            onPlayPause();
          }}
        >
          {currentSrc ? (
            <video
              ref={videoRef}
              key={currentSrc}
              src={currentSrc}
              playsInline
              muted={muteClips}
              onEnded={onEnded}
              onTimeUpdate={onTimeUpdate}
            />
          ) : (
            <div className="ranking-stage-empty hint">
              Upload all 5 clips to preview
            </div>
          )}
          <div
            className="ranking-rank-stack"
            style={{
              left: ranksPos.x,
              top: ranksPos.y,
              minWidth: RANK_FONT * 0.7 * scale,
            }}
            onPointerDown={(e) => {
              if (resizingCaption.current != null) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              draggingRanks.current = true;
              ranksOrigin.current = {
                pointerX: e.clientX,
                pointerY: e.clientY,
                startX: ranksPos.x,
                startY: ranksPos.y,
                startW: 0,
              };
            }}
            onPointerMove={(e) => {
              const capIndex = resizingCaption.current;
              if (capIndex != null) {
                const dx = e.clientX - ranksOrigin.current.pointerX;
                onCaptionWidthChange(
                  capIndex,
                  Math.max(MIN_CAPTION_W, ranksOrigin.current.startW + dx)
                );
                return;
              }
              if (!draggingRanks.current) return;
              const dx = e.clientX - ranksOrigin.current.pointerX;
              const dy = e.clientY - ranksOrigin.current.pointerY;
              onRanksPosChange({
                x: Math.max(0, ranksOrigin.current.startX + dx),
                y: Math.max(0, ranksOrigin.current.startY + dy),
              });
            }}
            onPointerUp={(e) => {
              draggingRanks.current = false;
              resizingCaption.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              draggingRanks.current = false;
              resizingCaption.current = null;
            }}
          >
            {ALL_RANKS.map((rank) => {
              const slotIndex = 5 - rank;
              const slot = slots[slotIndex];
              const appeared =
                playable && clipIndex >= slotIndex && Boolean(urls[slotIndex]);
              const caption = appeared ? (slot?.caption ?? "") : "";
              const wrap = slot?.wrap !== false;
              const captionWidth = slot?.captionWidth ?? 110;
              const tone = rankTone(rank);
              const wrappedCap = wrapOverlayText(
                caption,
                captionWidth / scale,
                capSize,
                wrap
              );
              const capH = overlayTextHeight(
                wrappedCap.trim() ? wrappedCap.trim() : wrappedCap,
                capSize,
                CAPTION_LINE_SPACING
              );
              return (
                <div
                  key={rank}
                  className={
                    "ranking-rank-row" +
                    (rank === newestRank && playing ? " is-entering" : "")
                  }
                  style={{
                    height: RANK_LINE_HEIGHT * scale,
                    width:
                      RANK_FONT * CAPTION_X_RATIO * scale +
                      (caption
                        ? wrap
                          ? captionWidth
                          : capSize * 6 * scale
                        : RANK_FONT * 0.6 * scale),
                  }}
                >
                  {appeared ? (
                    <span
                      className={
                        "ranking-rank-num" + (tone ? ` is-${tone}` : "")
                      }
                      style={{
                        fontSize: RANK_FONT * scale,
                        WebkitTextStroke: `${4 * scale}px black`,
                        paintOrder: "stroke fill",
                      }}
                    >
                      {rank}
                    </span>
                  ) : null}
                  {appeared && caption ? (
                    <span
                      className={
                        "ranking-rank-caption" + (wrap ? "" : " is-nowrap")
                      }
                      style={{
                        left: RANK_FONT * CAPTION_X_RATIO * scale,
                        top: centerAlong(0, RANK_FONT, capH) * scale,
                        width: wrap ? captionWidth : undefined,
                        fontSize: capSize * scale,
                        lineHeight: `${(capSize + CAPTION_LINE_SPACING) * scale}px`,
                        WebkitTextStroke: `${3 * scale}px black`,
                        paintOrder: "stroke fill",
                      }}
                    >
                      {wrappedCap}
                      <span
                        className="ranking-overlay-handle"
                        aria-hidden
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget
                            .closest(".ranking-rank-stack")
                            ?.setPointerCapture(e.pointerId);
                          resizingCaption.current = slotIndex;
                          draggingRanks.current = false;
                          ranksOrigin.current = {
                            pointerX: e.clientX,
                            pointerY: e.clientY,
                            startX: ranksPos.x,
                            startY: ranksPos.y,
                            startW: captionWidth,
                          };
                        }}
                      />
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <TitleOverlay
            title={title}
            pos={titlePos}
            onPosChange={onTitlePosChange}
            borderWidth={titleBorder}
            boxWidth={titleWidth}
            onBoxWidthChange={onTitleWidthChange}
            wrap={titleWrap}
            scale={scale}
            stageWidth={stageW}
          />
          <div
            className={
              "ranking-transport-overlay" +
              (chromeVisible ? " is-visible" : "")
            }
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="ranking-transport-row">
              <button type="button" disabled={!playable} onClick={onPlayPause}>
                {playing ? "Pause" : "Play"}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0.01, totalDuration)}
                step={0.05}
                value={Math.min(timeline, totalDuration || 0)}
                disabled={!playable}
                aria-label="Seek"
                onPointerDown={() => {
                  scrubbing.current = true;
                  bumpChrome();
                }}
                onPointerUp={() => {
                  scrubbing.current = false;
                  bumpChrome();
                }}
                onChange={(e) => {
                  seekTo(Number(e.target.value));
                  bumpChrome();
                }}
              />
              <span className="ranking-time">
                {playable
                  ? `${formatTime(timeline)} / ${formatTime(totalDuration)}`
                  : "0:00 / 0:00"}
              </span>
            </div>
          </div>
        </div>
      </div>
      <span className="hint">
        {playable
          ? `Clip ${clipIndex + 1}/5 · rank #${rankForIndex(clipIndex)}`
          : "Fill every slot first"}
      </span>
    </section>
  );
}
