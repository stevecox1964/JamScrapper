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
      <div className={`track-info ${visible ? 'visible' : ''}`}>
        {albumArt && (
          <img src={albumArt} alt="Album art" className="album-art" />
        )}
        <div className="track-text">
          <div className="track-title">{media.title}</div>
          <div className="track-artist">{media.artist}</div>
          {media.album && (
            <div className="track-album">{media.album}</div>
          )}
        </div>
      </div>
    </>
  );
}
