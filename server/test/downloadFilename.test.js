import { describe, expect, it } from "vitest";
import { safeDownloadFilename } from "../src/downloadFilename.js";

describe("safeDownloadFilename", () => {
  it("returns an ASCII-only mp4 filename for Unicode titles", () => {
    const filename = safeDownloadFilename("旅行 🎬 highlights");

    expect(filename).toBe("__ _ highlights.mp4");
    expect(/^[\x20-\x7E]+$/.test(filename)).toBe(true);
  });

  it("keeps an existing mp4 suffix after sanitizing", () => {
    expect(safeDownloadFilename("my:video.MP4")).toBe("my_video.MP4");
  });
});
