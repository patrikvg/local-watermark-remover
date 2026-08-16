type Props = {
  muteClips: boolean;
  onMuteChange: (mute: boolean) => void;
  bgmFilename: string | null;
  onBgmUpload: (file: File) => void;
  bgmVolume: number;
  onVolumeChange: (volume: number) => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  disabled?: boolean;
};

export default function AudioControls({
  muteClips,
  onMuteChange,
  bgmFilename,
  onBgmUpload,
  bgmVolume,
  onVolumeChange,
  masterVolume,
  onMasterVolumeChange,
  disabled = false,
}: Props) {
  const needsBgm = muteClips && !bgmFilename;

  return (
    <section className="audio-controls">
      <h2 className="section-title">Audio</h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={muteClips}
          disabled={disabled}
          onChange={(e) => onMuteChange(e.target.checked)}
        />
        Mute clip audio
      </label>

      <div className="audio-bgm-row">
        <label className="file-btn">
          <input
            type="file"
            accept="audio/*"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (file) onBgmUpload(file);
            }}
          />
          Choose BGM
        </label>
        <span className="hint">
          {bgmFilename ? bgmFilename : "Optional unless clips are muted"}
        </span>
      </div>

      <label className="volume-row">
        <span>BGM volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={bgmVolume}
          disabled={disabled || !bgmFilename}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
        <span className="time">{bgmVolume.toFixed(2)}</span>
      </label>

      <label className="volume-row">
        <span>Master volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          disabled={disabled}
          onChange={(e) => onMasterVolumeChange(Number(e.target.value))}
        />
        <span className="time">{masterVolume.toFixed(2)}</span>
      </label>

      {needsBgm && (
        <p className="message audio-warn">
          Add background music when clip audio is muted — export stays disabled
          until BGM is present.
        </p>
      )}
    </section>
  );
}
