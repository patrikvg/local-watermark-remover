import { describe, it, expect } from "vitest";
import {
  buildProbeArgs,
  buildDownloadArgs,
  pickBestResolution,
  labelResolution,
  parseProgressLine,
  summarizeProbe,
} from "../src/ytdlp.js";

const fixture = {
  title: "Demo Clip",
  duration: 42.5,
  formats: [
    { height: 720, width: 1280, vcodec: "avc1", acodec: "none" },
    { height: 2160, width: 3840, vcodec: "vp9", acodec: "none" },
    { height: null, width: null, vcodec: "none", acodec: "mp4a" },
    { height: 1080, width: 1920, vcodec: "avc1", acodec: "mp4a" },
  ],
};

describe("ytdlp helpers", () => {
  it("builds probe and download argv", () => {
    expect(buildProbeArgs("https://youtu.be/x")).toEqual([
      "-J",
      "--no-playlist",
      "https://youtu.be/x",
    ]);
    const dl = buildDownloadArgs({
      url: "https://youtu.be/x",
      outputTemplate: "C:/tmp/out.%(ext)s",
    });
    expect(dl).toContain("-f");
    expect(dl).toContain("bv*+ba/b");
    expect(dl).toContain("--merge-output-format");
    expect(dl).toContain("mp4");
    expect(dl).toContain("--newline");
    expect(dl.at(-1)).toBe("https://youtu.be/x");
  });

  it("picks best video resolution and labels it", () => {
    expect(pickBestResolution(fixture.formats)).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(labelResolution(3840, 2160)).toBe("3840×2160 (4K)");
    expect(labelResolution(1920, 1080)).toBe("1920×1080 (Full HD)");
    expect(labelResolution(1280, 720)).toBe("1280×720 (HD)");
    expect(labelResolution(640, 360)).toBe("640×360");
  });

  it("summarizes probe JSON", () => {
    expect(summarizeProbe(fixture, "youtube")).toEqual({
      title: "Demo Clip",
      duration: 42.5,
      width: 3840,
      height: 2160,
      resolutionLabel: "3840×2160 (4K)",
      platform: "youtube",
    });
  });

  it("parses download progress percent", () => {
    expect(parseProgressLine("[download]  45.2% of 10.00MiB")).toBeCloseTo(0.452);
    expect(parseProgressLine("[download] 100% of 10.00MiB")).toBe(1);
    expect(parseProgressLine("merging formats")).toBeNull();
  });
});
