import { useState, useEffect } from 'react';

export default function TrackInfo({ media }) {
  const [visible, setVisible] = useState(false);
  const [imgIndex, setImgIndex] = useState(0);

  useEffect(() => {
    if (media?.artist || media?.title) {
      setVisible(true);
      setImgIndex(0);
    }
  }, [media?.artist, media?.title]);

  // Cycle through artist images every 8 seconds
  useEffect(() => {
    if (!media?.artistImages?.length || media.artistImages.length <= 1) return;
    const interval = setInterval(() => {
      setImgIndex((i) => (i + 1) % media.artistImages.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [media?.artistImages]);

  if (!media || (!media.artist && !media.title)) return null;

  const artistImg = media.artistImages?.[imgIndex];
  const albumArt = media.albumArt;

  const accentColor = media.dominantColors?.[0]
    ? `rgb(${media.dominantColors[0].join(',')})`
    : null;

  return (
    <>
      {/* Background artist image */}
      {artistImg && (
        <div
          className="artist-bg"
          style={{ backgroundImage: `url(${artistImg})` }}
        />
      )}

      {/* Track info overlay */}
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
        </div>
      </div>
    </>
  );
}
