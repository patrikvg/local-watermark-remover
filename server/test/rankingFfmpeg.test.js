import { describe, it, expect } from "vitest";
import { escapeDrawtext, buildRankingArgs } from "../src/rankingFfmpeg.js";

describe("escapeDrawtext", () => {
  it("escapes colon and quotes", () => {
    expect(escapeDrawtext("Top: Best")).toContain("\\:");
  });
});

describe("buildRankingArgs", () => {
  it("includes five inputs, concat, drawtext ranks, and nvenc", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "Top 5",
      titlePos: { x: 100, y: 80 },
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "h264_nvenc",
      output: "out.mp4",
    });
    expect(args.filter((x) => x === "-i")).toHaveLength(5);
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("concat=n=5");
    expect(fc).toMatch(/drawtext=.*text=5/);
    expect(fc).toMatch(/drawtext=.*text=1/);
    expect(fc).toContain("text='Top 5'");
    expect(args).toContain("h264_nvenc");
  });

  it("requires bgm when clips muted", () => {
    expect(() =>
      buildRankingArgs({
        clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
        durations: [1, 1, 1, 1, 1],
        title: "T",
        titlePos: { x: 10, y: 10 },
        muteClips: true,
        bgmPath: null,
        bgmVolume: 1,
        encoder: "libx264",
        output: "out.mp4",
      })
    ).toThrow(/background music/i);
  });
});
