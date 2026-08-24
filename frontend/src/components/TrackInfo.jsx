import { useEffect, useRef, useCallback } from 'react';
import ArtistSlideshow, { buildChoreographyPayload } from './ArtistSlideshow';

import { API_BASE } from '../config';

export default function TrackInfo({ media, hasVideo }) {
  const choreographyRef = useRef([]);

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

  return (
    <ArtistSlideshow
      images={media.artistImages}
      hasVideo={hasVideo}
      onChoreographyUpdate={handleChoreographyUpdate}
    />
  );
}
