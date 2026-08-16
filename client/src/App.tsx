import { useState } from "react";
import WatermarkPage from "./pages/WatermarkPage";
import RankingPage from "./pages/RankingPage";
import DownloadPage from "./pages/DownloadPage";
import TikTokFormatPage from "./pages/TikTokFormatPage";

type Tab = "watermark" | "ranking" | "download" | "tiktok";

export default function App() {
  const [tab, setTab] = useState<Tab>("download");
  const [watermarkUploadId, setWatermarkUploadId] = useState<string | null>(
    null
  );

  return (
    <main className="app">
      <nav className="top-nav">
        <button
          type="button"
          className={tab === "download" ? "active" : ""}
          onClick={() => setTab("download")}
        >
          Download
        </button>
        <button
          type="button"
          className={tab === "tiktok" ? "active" : ""}
          onClick={() => setTab("tiktok")}
        >
          TikTok Format
        </button>
        <button
          type="button"
          className={tab === "watermark" ? "active" : ""}
          onClick={() => setTab("watermark")}
        >
          Watermark
        </button>
        <button
          type="button"
          className={tab === "ranking" ? "active" : ""}
          onClick={() => setTab("ranking")}
        >
          Ranking
        </button>
      </nav>
      {tab === "watermark" && (
        <WatermarkPage initialUploadId={watermarkUploadId} />
      )}
      {tab === "ranking" && <RankingPage />}
      {tab === "download" && (
        <DownloadPage
          onOpenWatermark={(uploadId) => {
            setWatermarkUploadId(uploadId);
            setTab("watermark");
          }}
        />
      )}
      {tab === "tiktok" && (
        <TikTokFormatPage
          onOpenWatermark={(uploadId) => {
            setWatermarkUploadId(uploadId);
            setTab("watermark");
          }}
        />
      )}
    </main>
  );
}
