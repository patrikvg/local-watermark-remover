import { useRef, useState } from "react";
import type { RankingClip } from "../../api";

export type SlotItem = {
  clip: RankingClip;
  objectUrl: string;
  caption: string;
  volume: number;
  wrap: boolean;
  captionWidth: number;
} | null;

type Props = {
  slots: SlotItem[];
  onUpload: (index: number, file: File) => void;
  onBatchUpload: (files: File[]) => void;
  onReorder: (from: number, to: number) => void;
  onCaptionChange: (index: number, caption: string) => void;
  onCaptionWrapChange: (index: number, wrap: boolean) => void;
  onClipVolumeChange: (index: number, volume: number) => void;
  disabled?: boolean;
};

function rankLabel(index: number) {
  return 5 - index;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${seconds.toFixed(1)}s`;
}

function takeVideoFiles(list: FileList | File[] | null): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi)$/i.test(f.name));
}

export default function ClipSlots({
  slots,
  onUpload,
  onBatchUpload,
  onReorder,
  onCaptionChange,
  onCaptionWrapChange,
  onClipVolumeChange,
  disabled = false,
}: Props) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [batchOver, setBatchOver] = useState(false);

  return (
    <div className="clip-slots-wrap">
      <div
        className={"batch-drop" + (batchOver ? " is-drag-over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setBatchOver(true);
        }}
        onDragLeave={() => setBatchOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setBatchOver(false);
          if (disabled) return;
          const files = takeVideoFiles(e.dataTransfer.files);
          if (files.length) onBatchUpload(files.slice(0, 5));
        }}
      >
        <label className="file-btn">
          <input
            type="file"
            accept="video/*"
            multiple
            disabled={disabled}
            onChange={(e) => {
              const files = takeVideoFiles(e.target.files);
              e.target.value = "";
              if (files.length) onBatchUpload(files.slice(0, 5));
            }}
          />
          Drop up to 5 videos here
        </label>
        <span className="hint">or pick multiple files — fills empty slots first</span>
      </div>

      <ol className="clip-slots">
        {slots.map((slot, index) => (
          <li
            key={slot?.clip.id ?? `empty-${index}`}
            className={
              "clip-slot" +
              (dragOver === index ? " is-drag-over" : "") +
              (slot ? " is-filled" : "")
            }
            draggable={Boolean(slot) && !disabled}
            onDragStart={() => {
              dragFrom.current = index;
            }}
            onDragEnd={() => {
              dragFrom.current = null;
              setDragOver(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(index);
            }}
            onDragLeave={() => {
              setDragOver((cur) => (cur === index ? null : cur));
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const files = takeVideoFiles(e.dataTransfer.files);
              if (files.length === 1 && !dragFrom.current) {
                onUpload(index, files[0]);
                return;
              }
              const from = dragFrom.current;
              if (from == null || from === index) return;
              onReorder(from, index);
              dragFrom.current = null;
            }}
          >
            <span className="clip-slot-rank" aria-hidden>
              #{rankLabel(index)}
            </span>
            <div className="clip-slot-body">
              {slot ? (
                <>
                  <span className="clip-slot-name" title={slot.clip.filename}>
                    {slot.clip.filename}
                  </span>
                  <span className="clip-slot-meta">
                    {formatDuration(slot.clip.duration)} · {slot.clip.width}×
                    {slot.clip.height}
                  </span>
                  <textarea
                    className="clip-slot-caption"
                    rows={2}
                    value={slot.caption}
                    disabled={disabled}
                    placeholder={'Place title e.g. "Ronaldo vs Barca"'}
                    onChange={(e) => onCaptionChange(index, e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  <label className="check-row clip-slot-wrap">
                    <input
                      type="checkbox"
                      checked={slot.wrap}
                      disabled={disabled}
                      onChange={(e) =>
                        onCaptionWrapChange(index, e.target.checked)
                      }
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    Wrap to next line
                  </label>
                  <label className="clip-slot-vol">
                    <span>Vol</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={slot.volume}
                      disabled={disabled}
                      onChange={(e) =>
                        onClipVolumeChange(index, Number(e.target.value))
                      }
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span className="time">{slot.volume.toFixed(2)}</span>
                  </label>
                </>
              ) : (
                <span className="hint">Empty — upload a clip</span>
              )}
            </div>
            <label className="file-btn clip-slot-upload">
              <input
                type="file"
                accept="video/*"
                disabled={disabled}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (file) onUpload(index, file);
                }}
              />
              {slot ? "Replace" : "Upload"}
            </label>
          </li>
        ))}
      </ol>
    </div>
  );
}
