import { useRef, useState } from "react";
import {
  CHAR_WIDTH_RATIO,
  TITLE_LINE_SPACING,
  TITLE_MIN_W,
  TITLE_SNAP_THRESHOLD,
  centerTitleX,
  wrapOverlayText,
} from "../../rankingLayout";

type Props = {
  title: string;
  pos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
  borderWidth: number;
  boxWidth: number;
  onBoxWidthChange: (width: number) => void;
  wrap: boolean;
  scale: number;
  stageWidth: number;
  fontFamilyCss: string;
  fontSizeCanvas: number;
  fontWeight: "regular" | "bold";
  color: string;
  align: "left" | "center" | "right";
};

export default function TitleOverlay({
  title,
  pos,
  onPosChange,
  borderWidth,
  boxWidth,
  onBoxWidthChange,
  wrap,
  scale,
  stageWidth,
  fontFamilyCss,
  fontSizeCanvas,
  fontWeight,
  color,
  align,
}: Props) {
  const dragging = useRef(false);
  const resizing = useRef(false);
  const origin = useRef({
    pointerX: 0,
    pointerY: 0,
    startX: 0,
    startY: 0,
    startW: 0,
  });
  const [snappedX, setSnappedX] = useState(false);
  const s = Math.max(0.05, scale);
  const bw = Math.max(0, borderWidth) * s;
  const canvasWidth = boxWidth / s;
  const display = wrapOverlayText(
    title || "Title",
    canvasWidth,
    fontSizeCanvas,
    wrap
  );
  const effectiveW = wrap
    ? boxWidth
    : Math.max(
        TITLE_MIN_W,
        String(display).length * fontSizeCanvas * CHAR_WIDTH_RATIO * s
      );

  return (
    <>
      {snappedX ? (
        <div
          className="ranking-snap-guide"
          style={{ left: stageWidth / 2 }}
          aria-hidden
        />
      ) : null}
      <div
        className={"ranking-title" + (wrap ? "" : " is-nowrap")}
        style={{
          left: pos.x,
          top: pos.y,
          width: boxWidth,
          fontFamily: fontFamilyCss,
          fontSize: fontSizeCanvas * s,
          fontWeight: fontWeight === "bold" ? 700 : 400,
          color,
          textAlign: align,
          lineHeight: `${(fontSizeCanvas + TITLE_LINE_SPACING) * s}px`,
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
            startW: boxWidth,
          };
        }}
        onPointerMove={(e) => {
          if (resizing.current) {
            const dx = e.clientX - origin.current.pointerX;
            onBoxWidthChange(Math.max(TITLE_MIN_W, origin.current.startW + dx));
            return;
          }
          if (!dragging.current) return;
          const dx = e.clientX - origin.current.pointerX;
          const dy = e.clientY - origin.current.pointerY;
          let nextX = Math.max(0, origin.current.startX + dx);
          const nextY = Math.max(0, origin.current.startY + dy);
          const cx = centerTitleX(stageWidth, effectiveW);
          const near = Math.abs(nextX - cx) <= TITLE_SNAP_THRESHOLD;
          if (near) nextX = cx;
          setSnappedX(near);
          onPosChange({ x: nextX, y: nextY });
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          resizing.current = false;
          setSnappedX(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragging.current = false;
          resizing.current = false;
          setSnappedX(false);
        }}
      >
        {display}
        <span
          className="ranking-overlay-handle"
          aria-hidden
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
            resizing.current = true;
            dragging.current = false;
            setSnappedX(false);
            origin.current = {
              pointerX: e.clientX,
              pointerY: e.clientY,
              startX: pos.x,
              startY: pos.y,
              startW: boxWidth,
            };
          }}
        />
      </div>
    </>
  );
}
