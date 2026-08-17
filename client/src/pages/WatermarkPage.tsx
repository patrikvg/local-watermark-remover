import { useEffect, useState } from "react";
import { getHealth, type Health } from "../api";
import VideoWorkspace from "../components/VideoWorkspace";

type Props = {
  initialUploadId?: string | null;
};

export default function WatermarkPage({ initialUploadId }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  const ready = Boolean(health?.ok);

  return (
    <>
      <header className="hero">
        <h1>Watermark Remover</h1>
        <p className="subtitle">
          Draw a box over the mark. Processing stays on your PC
          {health?.encoder ? ` · encoder ${health.encoder}` : ""}.
        </p>
      </header>
      {error && (
        <div className="banner danger">
          Cannot reach local API. Start with <code>npm run dev</code>. ({error})
        </div>
      )}
      {health && !health.ok && (
        <div className="banner danger">
          FFmpeg/ffprobe not found on PATH.
        </div>
      )}
      {health?.ok && health.inpaint?.ok && health.inpaint.device === "cuda" && (
        <div className="banner ok">KI bereit · CUDA</div>
      )}
      {health?.ok && health.inpaint?.ok && health.inpaint.device === "cpu" && (
        <div className="banner ok">KI bereit · CPU (langsam)</div>
      )}
      {health?.ok && !health.inpaint?.ok && (
        <div className="banner danger">
          {health.inpaint?.error ||
            "Inpaint engine not ready. In server/inpaint create a venv, install CUDA torch, pip install -r requirements.txt, then python worker.py --check."}
        </div>
      )}
      {health?.ok && (
        <VideoWorkspace
          ready={ready}
          inpaintReady={Boolean(health?.inpaint?.ok)}
          initialUploadId={initialUploadId}
        />
      )}
    </>
  );
}
