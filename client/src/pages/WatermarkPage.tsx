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
      {health?.ok && <div className="banner ok">Local engine ready.</div>}
      {health?.ok && (
        <VideoWorkspace ready={ready} initialUploadId={initialUploadId} />
      )}
    </>
  );
}
