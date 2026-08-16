import { describe, it, expect } from "vitest";
import { escapeDrawtext, buildRankingArgs } from "../src/rankingFfmpeg.js";
import { wrapOverlayText } from "../src/textWrap.js";

describe("escapeDrawtext", () => {
  it("escapes colon and quotes", () => {
    expect(escapeDrawtext("Top: Best")).toContain("\\:");
  });

  it("keeps real newlines so ffmpeg drawtext wraps", () => {
    expect(escapeDrawtext("Best\nGoals")).toBe("Best\nGoals");
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

  it("colors ranks 1–3 gold, silver, bronze", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "T",
      titlePos: { x: 10, y: 10 },
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "libx264",
      output: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/text=1:fontsize=\d+:fontcolor=0xFFD700/);
    expect(fc).toMatch(/text=2:fontsize=\d+:fontcolor=0xC0C0C0/);
    expect(fc).toMatch(/text=3:fontsize=\d+:fontcolor=0xCD7F32/);
    expect(fc).toMatch(/text=4:fontsize=\d+:fontcolor=white/);
    expect(fc).toMatch(/text=5:fontsize=\d+:fontcolor=white/);
  });

  it("wraps a long title at titleWidth and keeps one line when wrap is off", () => {
    const wrapped = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "Ranking Best Goals From Cristiano",
      titlePos: { x: 10, y: 10 },
      titleWidth: 220,
      titleWrap: true,
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "libx264",
      output: "out.mp4",
    });
    const sausage = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "Ranking Best Goals From Cristiano",
      titlePos: { x: 10, y: 10 },
      titleWidth: 220,
      titleWrap: false,
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "libx264",
      output: "out.mp4",
    });
    const wrappedFc = wrapped[wrapped.indexOf("-filter_complex") + 1];
    const sausageFc = sausage[sausage.indexOf("-filter_complex") + 1];
    expect(wrappedFc).toMatch(/text='Ranking\nBest/);
    expect(sausageFc).toContain("text='Ranking Best Goals From Cristiano'");
    expect(sausageFc).not.toMatch(/text='Ranking Best Goals From Cristiano\n/);
  });

  it("vertically centers a clip caption on the rank number", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "T",
      titlePos: { x: 10, y: 10 },
      ranksPos: { x: 0, y: 0 },
      captions: ["Hello\nWorld", "", "", "", ""],
      captionWraps: [true, true, true, true, true],
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "libx264",
      output: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    const cap = fc.match(/text='Hello\nWorld':fontsize=(\d+):[\s\S]*?:y=(\d+)/);
    expect(cap).not.toBeNull();
    const capSize = Number(cap[1]);
    const y = Number(cap[2]);
    const rankY = 140 * 4;
    const rankSize = 120;
    const textH = capSize * 2 + 8;
    expect(y).toBe(rankY + Math.round((rankSize - textH) / 2));
  });

  it("applies title font size color file and center align", () => {
    const args = buildRankingArgs({
      clips: ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"],
      durations: [1, 1, 1, 1, 1],
      title: "Top 5",
      titlePos: { x: 100, y: 80 },
      titleWidth: 900,
      titleFont: "arial",
      titleSize: 72,
      titleWeight: "bold",
      titleColor: "#ffcc00",
      titleAlign: "center",
      titleBorder: 4,
      muteClips: false,
      bgmPath: null,
      bgmVolume: 0.2,
      encoder: "libx264",
      output: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/fontsize=72/);
    expect(fc).toMatch(/fontcolor=0xFFCC00/);
    expect(fc).toMatch(/fontfile=/);
    expect(fc).toMatch(/borderw=4/);
    expect(fc).toMatch(/100\+\(900-tw\)\/2/);
  });
});

describe("wrapOverlayText", () => {
  it("breaks at the box width and honors manual newlines", () => {
    const wrapped = wrapOverlayText("Ranking Best Goals From", 280, 64, true);
    expect(wrapped).toContain("\n");
    expect(wrapped.split("\n").every((line) => line.length * 64 * 0.52 <= 280 + 64 * 0.52)).toBe(
      true
    );
    expect(wrapOverlayText("Hello\nWorld", 4000, 64, true)).toBe("Hello\nWorld");
  });

  it("collapses to one line when wrap is off", () => {
    expect(wrapOverlayText("Hello\nWorld", 100, 64, false)).toBe("Hello World");
  });
});
