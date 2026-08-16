import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import TitleOverlay from "./TitleOverlay";
import type { SlotItem } from "./ClipSlots";

type Props = {
  slots: SlotItem[];
  title: string;
  titlePos: { x: number; y: number };
  onTitlePosChange: (pos: { x: number; y: number }) => void;
  muteClips: boolean;
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
  muteClips,
  stageSizeRef,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);

  const urls = useMemo(
    () => slots.map((s) => s?.objectUrl ?? null),
    [slots]
  );
  const urlsKey = urls.map((u) => u ?? "").join("\0");
  const playable = urls.every(Boolean);
  const currentSrc = urls[clipIndex] ?? null;

  const visibleRanks = useMemo(() => {
    const ranks: number[] = [];
    for (let i = 0; i <= clipIndex; i++) {
      if (urls[i]) ranks.push(rankForIndex(i));
    }
    return ranks;
  }, [clipIndex, urls]);

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
    if (playing) {
      void v.play().catch(() => setPlaying(false));
    }
  }, [currentSrc, muteClips, playing]);

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
          <div className="ranking-rank-stack" aria-hidden>
            {visibleRanks.map((rank, i) => (
              <span
                key={rank}
                className={
                  "ranking-rank-num" +
                  (i === visibleRanks.length - 1 && playing
                    ? " is-entering"
                    : "")
                }
              >
                {rank}
              </span>
            ))}
          </div>
          <TitleOverlay
            title={title}
            pos={titlePos}
            onPosChange={onTitlePosChange}
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
