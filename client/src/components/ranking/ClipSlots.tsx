import { useRef, useState } from "react";
import type { RankingClip } from "../../api";

export type SlotItem = {
  clip: RankingClip;
  objectUrl: string;
} | null;

type Props = {
  slots: SlotItem[];
  onUpload: (index: number, file: File) => void;
  onReorder: (from: number, to: number) => void;
  disabled?: boolean;
};

function rankLabel(index: number) {
  return 5 - index;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${seconds.toFixed(1)}s`;
}

export default function ClipSlots({
  slots,
  onUpload,
  onReorder,
  disabled = false,
}: Props) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
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
  );
}
