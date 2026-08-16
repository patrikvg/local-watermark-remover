import { useState } from "react";
import WatermarkPage from "./pages/WatermarkPage";
import RankingPage from "./pages/RankingPage";

type Tab = "watermark" | "ranking";

export default function App() {
  const [tab, setTab] = useState<Tab>("watermark");
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
      </nav>
      {tab === "watermark" ? <WatermarkPage /> : <RankingPage />}
    </main>
  );
}
