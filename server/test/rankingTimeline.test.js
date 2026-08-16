import { describe, it, expect } from "vitest";
import {
  buildSegments,
  rankForIndex,
  stackPositions,
} from "../src/rankingTimeline.js";

describe("rankForIndex", () => {
  it("maps 0..4 to ranks 5..1", () => {
    expect([0, 1, 2, 3, 4].map(rankForIndex)).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("buildSegments", () => {
  it("computes start times from durations", () => {
    const segs = buildSegments([2, 3, 1, 4, 2]);
    expect(segs).toEqual([
      { index: 0, rank: 5, start: 0, duration: 2 },
      { index: 1, rank: 4, start: 2, duration: 3 },
      { index: 2, rank: 3, start: 5, duration: 1 },
      { index: 3, rank: 2, start: 6, duration: 4 },
      { index: 4, rank: 1, start: 10, duration: 2 },
    ]);
    expect(segs.reduce((s, x) => s + x.duration, 0)).toBe(12);
  });

  it("rejects wrong clip count", () => {
    expect(() => buildSegments([1, 2, 3])).toThrow(/exactly 5/i);
  });
});

describe("stackPositions", () => {
  it("stacks rank 1 at top and 5 at bottom by default", () => {
    const pos = stackPositions({
      lineHeight: 140,
      fontSize: 120,
    });
    expect(pos[1].x).toBe(48);
    expect(pos[1].y).toBe(220);
    expect(pos[2].y).toBe(360);
    expect(pos[5].y).toBe(220 + 140 * 4);
  });

  it("uses origin as the canvas position of rank 1", () => {
    const pos = stackPositions({
      lineHeight: 140,
      fontSize: 120,
      originX: 64,
      originY: 640,
    });
    expect(pos[1].x).toBe(64);
    expect(pos[1].y).toBe(640);
    expect(pos[2].y).toBe(780);
    expect(pos[5].y).toBe(640 + 140 * 4);
  });
});
