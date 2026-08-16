import { describe, expect, it } from "vitest";

/** Keep in sync with client/src/rankingLayout.ts centerTitleX/Y */
function centerTitleX(stageWidth, boxWidth) {
  return Math.max(0, (Number(stageWidth) - Number(boxWidth)) / 2);
}

function centerTitleY(stageHeight, boxHeight) {
  return Math.max(0, (Number(stageHeight) - Number(boxHeight)) / 2);
}

describe("titleCenter", () => {
  it("centers X for a box narrower than the stage", () => {
    expect(centerTitleX(270, 210)).toBe(30);
  });

  it("clamps X to 0 when box is wider than the stage", () => {
    expect(centerTitleX(200, 240)).toBe(0);
  });

  it("centers Y for a short box", () => {
    expect(centerTitleY(480, 80)).toBe(200);
  });

  it("clamps Y to 0 when box is taller than the stage", () => {
    expect(centerTitleY(100, 140)).toBe(0);
  });
});
