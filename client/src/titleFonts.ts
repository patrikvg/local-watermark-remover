export const TITLE_FONT_OPTIONS = [
  { id: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { id: "impact", label: "Impact", css: "Impact, Haettenschweiler, sans-serif" },
  { id: "segoe", label: "Segoe UI", css: '"Segoe UI", Tahoma, sans-serif' },
  { id: "georgia", label: "Georgia", css: "Georgia, serif" },
  { id: "consolas", label: "Consolas", css: "Consolas, monospace" },
] as const;

export type TitleFontId = (typeof TITLE_FONT_OPTIONS)[number]["id"];

export function cssFamilyForTitleFont(id: TitleFontId | string) {
  return (
    TITLE_FONT_OPTIONS.find((f) => f.id === id)?.css ??
    TITLE_FONT_OPTIONS[0].css
  );
}
