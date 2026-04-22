import { useState, useEffect, useRef, useCallback } from 'react';
import ArtistSlideshow, { buildChoreographyPayload } from './ArtistSlideshow';

import { API_BASE } from '../config';

export default function TrackInfo({ media, hasVideo }) {
  const [visible, setVisible] = useState(false);
  const [retracted, setRetracted] = useState(false);
  const retractTimer = useRef(null);
  const choreographyRef = useRef([]);

  // Slide in on new song, auto-retract after 6 seconds
  useEffect(() => {
    if (media?.artist || media?.title) {
      setVisible(true);
      setRetracted(false);

      // Clear any existing timer
      if (retractTimer.current) clearTimeout(retractTimer.current);

      // Auto-retract after 6 seconds
      retractTimer.current = setTimeout(() => {
        setRetracted(true);
      }, 6000);
    }

    return () => {
      if (retractTimer.current) clearTimeout(retractTimer.current);
    };
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
        className={`track-info ${visible ? 'visible' : ''} ${retracted ? 'retracted' : ''}`}
        style={accentColor ? { borderColor: `${accentColor}33` } : undefined}
        onMouseEnter={() => {
          if (retractTimer.current) clearTimeout(retractTimer.current);
        }}
        onMouseLeave={() => {
          if (!retracted) {
            retractTimer.current = setTimeout(() => setRetracted(true), 3000);
          }
        }}
      >
        {/* Pull-tab arrow — visible when retracted */}
        <button
          type="button"
          className="track-info-tab"
          onClick={(e) => {
            e.stopPropagation();
            setRetracted((r) => !r);
            // If pulling out, restart the auto-retract timer
            if (retracted) {
              if (retractTimer.current) clearTimeout(retractTimer.current);
              retractTimer.current = setTimeout(() => setRetracted(true), 6000);
            }
          }}
          title={retracted ? 'Show track info' : 'Hide track info'}
        >
          <span className="tab-arrow">{retracted ? '▶' : '◀'}</span>
        </button>
        {albumArt && (
          <img src={albumArt} alt="Album art" className="album-art" />
        )}
        <div className="track-text">
          <div
            className="track-artist"
            style={accentColor ? { color: accentColor } : undefined}
          >
            {media.artist}
          </div>
          <div className="track-title">{media.title}</div>
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
          {media.detectionSource === 'fingerprint' && (
            <span className="detection-badge">Identified</span>
          )}
          {media.youtubeVideoId && (
            <div className="track-share">
              <a
                href={`https://www.youtube.com/watch?v=${media.youtubeVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="share-link"
                title="Open on YouTube"
              >
                youtube.com/watch?v={media.youtubeVideoId}
              </a>
              <button
                type="button"
                className="share-copy"
                onClick={() => {
                  const url = `https://www.youtube.com/watch?v=${media.youtubeVideoId}`;
                  navigator.clipboard?.writeText(url);
                }}
                title="Copy link"
              >
                Copy
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
