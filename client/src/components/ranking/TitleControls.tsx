import {
  TITLE_FONT_OPTIONS,
  type TitleFontId,
} from "../../titleFonts";

type Props = {
  font: TitleFontId;
  onFontChange: (v: TitleFontId) => void;
  size: number;
  onSizeChange: (v: number) => void;
  weight: "regular" | "bold";
  onWeightChange: (v: "regular" | "bold") => void;
  color: string;
  onColorChange: (v: string) => void;
  align: "left" | "center" | "right";
  onAlignChange: (v: "left" | "center" | "right") => void;
  border: number;
  onBorderChange: (v: number) => void;
  disabled?: boolean;
};

export default function TitleControls({
  font,
  onFontChange,
  size,
  onSizeChange,
  weight,
  onWeightChange,
  color,
  onColorChange,
  align,
  onAlignChange,
  border,
  onBorderChange,
  disabled,
}: Props) {
  return (
    <div className="title-toolbar">
      <label>
        <span className="sr-only">Font</span>
        <select
          value={font}
          disabled={disabled}
          onChange={(e) => onFontChange(e.target.value as TitleFontId)}
        >
          {TITLE_FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Size</span>
        <input
          type="number"
          min={24}
          max={120}
          step={2}
          value={size}
          disabled={disabled}
          onChange={(e) => onSizeChange(Number(e.target.value))}
        />
      </label>
      <button
        type="button"
        className={weight === "bold" ? "is-active" : ""}
        disabled={disabled}
        aria-pressed={weight === "bold"}
        onClick={() =>
          onWeightChange(weight === "bold" ? "regular" : "bold")
        }
      >
        B
      </button>
      <div className="title-align">
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={align === a ? "is-active" : ""}
            disabled={disabled}
            aria-pressed={align === a}
            onClick={() => onAlignChange(a)}
          >
            {a[0].toUpperCase()}
          </button>
        ))}
      </div>
      <label>
        <span className="sr-only">Color</span>
        <input
          type="color"
          value={color.startsWith("#") ? color : `#${color}`}
          disabled={disabled}
          onChange={(e) => onColorChange(e.target.value)}
        />
      </label>
      <label className="title-stroke">
        <span>Stroke</span>
        <input
          type="range"
          min={0}
          max={12}
          step={1}
          value={border}
          disabled={disabled}
          onChange={(e) => onBorderChange(Number(e.target.value))}
        />
        <span className="time">{border}px</span>
      </label>
    </div>
  );
}
