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

  it("builds with mixed hasAudio flags", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1.5, 2, 1, 1, 1],
      hasAudio: [true, false, true, false, true],
      title: "Mixed",
      titlePos: { x: 10, y: 10 },
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.3,
      encoder: "libx264",
      output: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("concat=n=5");
    expect(fc).toContain("anullsrc=");
    expect(fc).toContain("apad");
    expect(fc).toMatch(/\[0:a\]volume=1,apad/);
    expect(fc).toMatch(/anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:2/);
  });

  it("adds amix normalize=0 when BGM is present", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "With BGM",
      titlePos: { x: 10, y: 10 },
      muteClips: true,
      bgmPath: "bgm.mp3",
      bgmVolume: 0.4,
      encoder: "libx264",
      output: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0");
  });

  it("includes captions and master volume when provided", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "Top\nFive",
      titlePos: { x: 10, y: 10 },
      titleBorder: 5,
      ranksPos: { x: 20, y: 30 },
      captions: ["A", "", "C", "", "E"],
      clipVolumes: [0.5, 1, 1, 1, 1],
      masterVolume: 0.8,
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "libx264",
      output: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("text='A'");
    expect(fc).toContain("borderw=5");
    expect(fc).toContain("volume=0.8");
    expect(fc).toMatch(/\[0:a\]volume=0\.5/);
  });
});
