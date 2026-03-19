import { useState, useEffect, useRef, useCallback } from 'react';
import ArtistSlideshow, { buildChoreographyPayload } from './ArtistSlideshow';

const API_BASE = 'http://localhost:8766';

export default function TrackInfo({ media, hasVideo }) {
  const [visible, setVisible] = useState(false);
  const choreographyRef = useRef([]);

  useEffect(() => {
    if (media?.artist || media?.title) {
      setVisible(true);
    }
  }, [media?.artist, media?.title]);

  // Save choreography when track changes (if we have events from the previous track)
  const prevMediaRef = useRef(null);
  useEffect(() => {
    const trackKey = `${media?.artist}|${media?.title}`;
    const prevKey = prevMediaRef.current
      ? `${prevMediaRef.current.artist}|${prevMediaRef.current.title}`
      : null;
    if (prevKey && prevKey !== trackKey && choreographyRef.current.length > 1) {
      const prev = prevMediaRef.current;
      const payload = buildChoreographyPayload(
        choreographyRef.current,
        prev,
        prev.artistImages || []
      );
      fetch(`${API_BASE}/choreography`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {}); // fire-and-forget
    }
    prevMediaRef.current = media ? { ...media } : null;
  }, [media?.artist, media?.title]);

  const handleChoreographyUpdate = useCallback((events) => {
    choreographyRef.current = events;
  }, []);

  if (!media || (!media.artist && !media.title)) return null;

  const albumArt = media.albumArt;
  const dl = media.videoDownloadStatus;

  const accentColor = media.dominantColors?.[0]
    ? `rgb(${media.dominantColors[0].join(',')})`
    : null;

  return (
    <>
      <ArtistSlideshow
        images={media.artistImages}
        hasVideo={hasVideo}
        onChoreographyUpdate={handleChoreographyUpdate}
      />

      <div
        className={`track-info ${visible ? 'visible' : ''}`}
        style={accentColor ? { borderColor: `${accentColor}33` } : undefined}
      >
        {albumArt && (
          <img src={albumArt} alt="Album art" className="album-art" />
        )}
        <div className="track-text">
          <div className="track-title">{media.title}</div>
          <div
            className="track-artist"
            style={accentColor ? { color: accentColor } : undefined}
          >
            {media.artist}
          </div>
          {media.album && (
            <div className="track-album">{media.album}</div>
          )}
          {media.genres?.length > 0 && (
            <div className="track-genres">
              {media.genres.slice(0, 4).map((genre) => (
                <span key={genre} className="genre-tag">{genre}</span>
              ))}
            </div>
          )}
          {media.detectionSource && (
            <span className="detection-badge">
              {media.detectionSource === 'fingerprint' ? 'Identified' : 'Now Playing'}
            </span>
          )}
          {dl && dl.state === 'downloading' && (
            <div className="download-status">
              <div className="download-bar">
                <div
                  className="download-fill"
                  style={{ width: `${dl.progress}%` }}
                />
              </div>
              <span className="download-text">Saving {dl.progress}%</span>
            </div>
          )}
          {dl && dl.state === 'completed' && (
            <span className="download-complete">
              Saved ({dl.fileSizeMB?.toFixed(1)} MB)
            </span>
          )}
        </div>
      </div>
    </>
  );
}
