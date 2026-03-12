export default function PlayerControls({
  visible,
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  volume,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onVolume,
}) {
  if (!visible) return null;

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = Number.isFinite(currentTime) ? currentTime : 0;
  const progress = safeDuration > 0 ? Math.min(100, (safeTime / safeDuration) * 100) : 0;

  const fmt = (s) => {
    const n = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(n / 60);
    const r = n % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  return (
    <div className="player-controls">
      <div className="player-track">
        <div className="player-title">{currentTrack?.title || currentTrack?.videoTitle || 'No track selected'}</div>
        <div className="player-artist">{currentTrack?.artist || ''}</div>
      </div>

      <div className="player-buttons">
        <button className="player-btn" onClick={onPrev} title="Previous">Prev</button>
        <button className="player-btn player-btn-main" onClick={onPlayPause} title="Play/Pause">
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button className="player-btn" onClick={onNext} title="Next">Next</button>
      </div>

      <div className="player-seek">
        <span className="player-time">{fmt(safeTime)}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          onChange={(e) => onSeek((Number(e.target.value) / 100) * safeDuration)}
        />
        <span className="player-time">{fmt(safeDuration)}</span>
      </div>

      <div className="player-volume">
        <span>Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
