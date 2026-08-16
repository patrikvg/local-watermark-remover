import { describe, it, expect } from "vitest";
import { parseDownloadUrl } from "../src/downloadUrl.js";

describe("parseDownloadUrl", () => {
  it("accepts youtube watch and youtu.be", () => {
    expect(parseDownloadUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      ok: true,
      platform: "youtube",
    });
    expect(parseDownloadUrl("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      ok: true,
      platform: "youtube",
    });
    expect(parseDownloadUrl("https://m.youtu.be/dQw4w9WgXcQ")).toMatchObject({
      ok: true,
      platform: "youtube",
    });
    expect(
      parseDownloadUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    ).toMatchObject({
      ok: true,
      platform: "youtube",
    });
  });

  it("accepts tiktok URLs", () => {
    expect(
      parseDownloadUrl("https://www.tiktok.com/@user/video/1234567890123456789")
    ).toMatchObject({ ok: true, platform: "tiktok" });
    expect(parseDownloadUrl("https://vm.tiktok.com/ZMabcdef/")).toMatchObject({
      ok: true,
      platform: "tiktok",
    });
  });

  it("rejects other hosts and empty input", () => {
    expect(parseDownloadUrl("https://instagram.com/reel/abc").ok).toBe(false);
    expect(parseDownloadUrl("not-a-url").ok).toBe(false);
    expect(parseDownloadUrl("").ok).toBe(false);
  });

  it("rejects identifiable non-video YouTube URL shapes", () => {
    expect(
      parseDownloadUrl("https://www.youtube.com/playlist?list=PL123").ok
    ).toBe(false);
    expect(
      parseDownloadUrl("https://www.youtube.com/channel/UC123").ok
    ).toBe(false);
    expect(parseDownloadUrl("https://www.youtube.com/user/example").ok).toBe(
      false
    );
  });
});
