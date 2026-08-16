import { useRef } from "react";

type Props = {
  title: string;
  pos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
  borderWidth: number;
};

export default function TitleOverlay({
  title,
  pos,
  onPosChange,
  borderWidth,
}: Props) {
  const dragging = useRef(false);
  const origin = useRef({ pointerX: 0, pointerY: 0, startX: 0, startY: 0 });
  const bw = Math.max(0, borderWidth);

  return (
    <div
      className="ranking-title"
      style={{
        left: pos.x,
        top: pos.y,
        WebkitTextStroke: bw > 0 ? `${bw}px black` : undefined,
        paintOrder: "stroke fill",
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        origin.current = {
          pointerX: e.clientX,
          pointerY: e.clientY,
          startX: pos.x,
          startY: pos.y,
        };
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const dx = e.clientX - origin.current.pointerX;
        const dy = e.clientY - origin.current.pointerY;
        onPosChange({
          x: Math.max(0, origin.current.startX + dx),
          y: Math.max(0, origin.current.startY + dy),
        });
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {title || "Title"}
    </div>
  );
}
