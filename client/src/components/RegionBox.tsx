import { useCallback, useRef, useState, type PointerEvent } from "react";
import type { Box } from "../api";

type Props = {
  box: Box | null;
  onChange: (box: Box | null) => void;
  disabled?: boolean;
};

type Corner = "nw" | "ne" | "sw" | "se";

type DragMode =
  | { type: "create"; startX: number; startY: number }
  | { type: "move"; origin: Box; startX: number; startY: number }
  | {
      type: "resize";
      corner: Corner;
      origin: Box;
      startX: number;
      startY: number;
    };

const MIN = 16;

function clampBox(box: Box, w: number, h: number): Box {
  let { x, y, width, height } = box;
  width = Math.max(MIN, width);
  height = Math.max(MIN, height);
  x = Math.min(Math.max(0, x), Math.max(0, w - width));
  y = Math.min(Math.max(0, y), Math.max(0, h - height));
  if (x + width > w) width = w - x;
  if (y + height > h) height = h - y;
  return { x, y, width: Math.max(MIN, width), height: Math.max(MIN, height) };
}

export default function RegionBox({ box, onChange, disabled }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragMode | null>(null);

  const localPoint = useCallback((e: PointerEvent) => {
    const el = rootRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = localPoint(e);
    const target = e.target as HTMLElement;
    const corner = target.dataset.corner as Corner | undefined;

    if (corner && box) {
      setDrag({
        type: "resize",
        corner,
        origin: box,
        startX: p.x,
        startY: p.y,
      });
      return;
    }

    if (box) {
      const inside =
        p.x >= box.x &&
        p.x <= box.x + box.width &&
        p.y >= box.y &&
        p.y <= box.y + box.height;
      if (inside) {
        setDrag({
          type: "move",
          origin: box,
          startX: p.x,
          startY: p.y,
        });
        return;
      }
    }

    setDrag({ type: "create", startX: p.x, startY: p.y });
    onChange({ x: p.x, y: p.y, width: MIN, height: MIN });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = localPoint(e);

    if (drag.type === "create") {
      const x = Math.min(drag.startX, p.x);
      const y = Math.min(drag.startY, p.y);
      const width = Math.abs(p.x - drag.startX);
      const height = Math.abs(p.y - drag.startY);
      onChange(clampBox({ x, y, width, height }, p.w, p.h));
      return;
    }

    if (drag.type === "move") {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      onChange(
        clampBox(
          {
            ...drag.origin,
            x: drag.origin.x + dx,
            y: drag.origin.y + dy,
          },
          p.w,
          p.h
        )
      );
      return;
    }

    const o = drag.origin;
    let { x, y, width, height } = o;
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if (drag.corner.includes("w")) {
      x = o.x + dx;
      width = o.width - dx;
    }
    if (drag.corner.includes("e")) {
      width = o.width + dx;
    }
    if (drag.corner.includes("n")) {
      y = o.y + dy;
      height = o.height - dy;
    }
    if (drag.corner.includes("s")) {
      height = o.height + dy;
    }
    if (width < MIN) {
      if (drag.corner.includes("w")) x = o.x + o.width - MIN;
      width = MIN;
    }
    if (height < MIN) {
      if (drag.corner.includes("n")) y = o.y + o.height - MIN;
      height = MIN;
    }
    onChange(clampBox({ x, y, width, height }, p.w, p.h));
  };

  const onPointerUp = () => setDrag(null);

  return (
    <div
      ref={rootRef}
      className={`region-overlay${disabled ? " is-disabled" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {box && (
        <div
          className="region-box"
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
          }}
        >
          <span data-corner="nw" className="handle nw" />
          <span data-corner="ne" className="handle ne" />
          <span data-corner="sw" className="handle sw" />
          <span data-corner="se" className="handle se" />
        </div>
      )}
    </div>
  );
}
