import { useState } from 'react';

export default function PlayerControls({
  visible,
  media,
  currentTrack,
  nextTrack,
  radioOn,
  queuePosition,
  queueLength,
  isPlaying,
  currentTime,
  duration,
  volume,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  vote,
  onVote,
  moodSlot,
}) {
  const [retracted, setRetracted] = useState(false);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = Number.isFinite(currentTime) ? currentTime : 0;
  const progress = safeDuration > 0 ? Math.min(100, (safeTime / safeDuration) * 100) : 0;

  const fmt = (s) => {
    const n = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(n / 60);
    const r = n % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  // One card for everything: song info on the left, transport on the right.
  // Transport only makes sense in player mode; live mode is info-only.
  const showTransport = visible;
  const artist = media?.artist || currentTrack?.artist || '';
  const title = media?.title || currentTrack?.title || currentTrack?.videoTitle || '';
  const videoId = media?.youtubeVideoId || currentTrack?.videoId || '';
  const accentColor = media?.dominantColors?.[0]
    ? `rgb(${media.dominantColors[0].join(',')})`
    : null;

  if (!showTransport && !artist && !title) return null;

  return (
    <div className={`player-controls ${retracted ? 'retracted' : ''}`}>
      {/* Pull-tab arrow — same idea as the track info card on the left */}
      <button
        type="button"
        className="player-controls-tab"
        onClick={() => setRetracted((r) => !r)}
        title={retracted ? 'Show player card' : 'Hide player card'}
      >
        <span className="tab-arrow">{retracted ? '▲' : '▼'}</span>
      </button>

      <div className="player-main">
        {media?.albumArt && (
          <img src={media.albumArt} alt="Album art" className="player-art" />
        )}
        <div className="player-track">
          <div className="player-title">{title || 'No track selected'}</div>
          <div
            className="player-artist"
            style={accentColor ? { color: accentColor } : undefined}
          >
            {artist}
          </div>
          {media?.album && <div className="player-album">{media.album}</div>}
          {media?.genres?.length > 0 && (
            <div className="player-genres">
              {media.genres.slice(0, 4).map((genre) => (
                <span key={genre} className="genre-tag">{genre}</span>
              ))}
            </div>
          )}
          <div className="player-track-meta">
            {showTransport && queueLength > 0 && (
              <span className="player-queue-pos">{queuePosition + 1} / {queueLength}</span>
            )}
            {media?.youtubeSearchStatus && (
              <span
                className={`yt-status-badge yt-status-${media.youtubeSearchStatus}`}
                title={
                  media.youtubeSearchStatus === 'found' ? 'YouTube video found — live video mode' :
                  media.youtubeSearchStatus === 'searching' ? 'Searching YouTube for a matching video' :
                  media.youtubeSearchStatus === 'not_found' ? 'No YouTube match — synthetic video mode' :
                  ''
                }
              >
                {media.youtubeSearchStatus === 'found' && '● YT'}
                {media.youtubeSearchStatus === 'searching' && '… Searching'}
                {media.youtubeSearchStatus === 'not_found' && '◌ Synthetic'}
              </span>
            )}
            {videoId && (
              <button
                type="button"
                className="player-copy-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(`https://www.youtube.com/watch?v=${videoId}`);
                }}
                title="Copy the YouTube link"
              >
                Copy link
              </button>
            )}
          </div>
        </div>
      </div>

      {showTransport && (
        <div className="player-transport">
          <div className="player-buttons">
            <button
              className={`player-btn player-btn-vote${vote > 0 ? ' voted-up' : ''}`}
              onClick={() => onVote?.(1)}
              title="More like this — Rando will lean this way"
            >
              &#128077;
            </button>
            <button className="player-btn" onClick={onPrev} title="Play the last song again">Prev</button>
            <button className="player-btn player-btn-main" onClick={onPlayPause} title="Play/Pause">
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button className="player-btn" onClick={onNext} title="Not right now — shifts the vibe away, but does not count against the song">Next</button>
            <button
              className={`player-btn player-btn-vote${vote < 0 ? ' voted-down' : ''}`}
              onClick={() => onVote?.(-1)}
              title="Less like this — skips it and steers Rando away"
            >
              &#128078;
            </button>
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
      )}

      {showTransport && moodSlot}

      {showTransport && nextTrack && (
        <div className="player-up-next" onClick={onNext} title="Skip to next">
          <span className="player-up-next-label">Up next:</span>
          <span className="player-up-next-track">{nextTrack.artist} — {nextTrack.title || nextTrack.videoTitle}</span>
        </div>
      )}
      {showTransport && !nextTrack && radioOn && (
        <div className="player-up-next" onClick={onNext} title="Skip to next">
          <span className="player-up-next-label">Up next:</span>
          <span className="player-up-next-track">Rando picks when this one ends</span>
        </div>
      )}
    </div>
  );
}
