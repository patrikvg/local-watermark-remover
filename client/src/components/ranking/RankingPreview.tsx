import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import TitleOverlay from "./TitleOverlay";
import type { SlotItem } from "./ClipSlots";

type Props = {
  slots: SlotItem[];
  title: string;
  titlePos: { x: number; y: number };
  onTitlePosChange: (pos: { x: number; y: number }) => void;
  titleBorder: number;
  ranksPos: { x: number; y: number };
  onRanksPosChange: (pos: { x: number; y: number }) => void;
  muteClips: boolean;
  masterVolume: number;
  stageSizeRef: MutableRefObject<{ width: number; height: number }>;
};

function rankForIndex(index: number) {
  return 5 - index;
}

export default function RankingPreview({
  slots,
  title,
  titlePos,
  onTitlePosChange,
  titleBorder,
  ranksPos,
  onRanksPosChange,
  muteClips,
  masterVolume,
  stageSizeRef,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);
  const draggingRanks = useRef(false);
  const ranksOrigin = useRef({
    pointerX: 0,
    pointerY: 0,
    startX: 0,
    startY: 0,
  });

  const urls = useMemo(
    () => slots.map((s) => s?.objectUrl ?? null),
    [slots]
  );
  const urlsKey = urls.map((u) => u ?? "").join("\0");
  const playable = urls.every(Boolean);
  const currentSrc = urls[clipIndex] ?? null;
  const currentVolume = slots[clipIndex]?.volume ?? 1;

  // Visible ranks sorted top→bottom for display (1 above 5)
  const visibleRanks = useMemo(() => {
    const ranks: number[] = [];
    for (let i = 0; i <= clipIndex; i++) {
      if (urls[i]) ranks.push(rankForIndex(i));
    }
    return ranks.slice().sort((a, b) => a - b);
  }, [clipIndex, urls]);

  const newestRank = playable ? rankForIndex(clipIndex) : null;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      stageSizeRef.current = { width: rect.width, height: rect.height };
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageSizeRef]);

  useEffect(() => {
    setClipIndex(0);
    setPlaying(false);
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  }, [urlsKey]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !currentSrc) return;
    v.muted = muteClips;
    v.volume = Math.max(0, Math.min(1, currentVolume * masterVolume));
    if (playing) {
      void v.play().catch(() => setPlaying(false));
    }
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
      setClipIndex((i) => i + 1);
      return;
    }
    setPlaying(false);
    setClipIndex(0);
  }

  return (
    <section className="ranking-preview">
      <h2 className="section-title">Preview (9:16)</h2>
      <p className="hint">Drag title or rank stack to reposition.</p>
      <div className="ranking-stage-wrap">
        <div ref={stageRef} className="ranking-stage">
          {currentSrc ? (
            <video
              ref={videoRef}
              key={currentSrc}
              src={currentSrc}
              playsInline
              muted={muteClips}
              onEnded={onEnded}
            />
          ) : (
            <div className="ranking-stage-empty hint">
              Upload all 5 clips to preview
            </div>
          )}
          <div
            className="ranking-rank-stack"
            style={{ left: ranksPos.x, top: ranksPos.y }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              draggingRanks.current = true;
              ranksOrigin.current = {
                pointerX: e.clientX,
                pointerY: e.clientY,
                startX: ranksPos.x,
                startY: ranksPos.y,
              };
            }}
            onPointerMove={(e) => {
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
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              draggingRanks.current = false;
            }}
          >
            {visibleRanks.map((rank) => {
              const slotIndex = 5 - rank;
              const caption = slots[slotIndex]?.caption ?? "";
              return (
                <div
                  key={rank}
                  className={
                    "ranking-rank-row" +
                    (rank === newestRank && playing ? " is-entering" : "")
                  }
                >
                  <span className="ranking-rank-num">{rank}</span>
                  {caption ? (
                    <span className="ranking-rank-caption">{caption}</span>
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
          />
        </div>
      </div>
      <div className="actions">
        <button type="button" disabled={!playable} onClick={onPlayPause}>
          {playing ? "Pause" : "Play preview"}
        </button>
        <span className="hint">
          {playable
            ? `Clip ${clipIndex + 1}/5 · rank #${rankForIndex(clipIndex)}`
            : "Fill every slot first"}
        </span>
      </div>
    </section>
  );
}
