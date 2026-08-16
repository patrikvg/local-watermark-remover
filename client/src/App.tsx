import { useState } from "react";
import WatermarkPage from "./pages/WatermarkPage";
import RankingPage from "./pages/RankingPage";
import DownloadPage from "./pages/DownloadPage";

type Tab = "watermark" | "ranking" | "download";

export default function App() {
  const [tab, setTab] = useState<Tab>("watermark");
  const [watermarkUploadId, setWatermarkUploadId] = useState<string | null>(
    null
  );

  return (
    <main className="app">
      <nav className="top-nav">
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
        <button
          type="button"
          className={tab === "download" ? "active" : ""}
          onClick={() => setTab("download")}
        >
          Download
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
    </main>
  );
}
