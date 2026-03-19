import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const SLIDE_DURATION = 8000;    // ms per slide
const FADE_DURATION = 2000;     // ms crossfade

/**
 * Dual-layer crossfade slideshow for artist background images.
 * Records choreography (image sequence + timings) that can be saved to JSON.
 */
export default function ArtistSlideshow({ images, hasVideo, onChoreographyUpdate }) {
  const [activeLayer, setActiveLayer] = useState(0); // 0 or 1
  const [layerImages, setLayerImages] = useState([null, null]);
  const [layerOpacity, setLayerOpacity] = useState([1, 0]);
  const imgIndex = useRef(0);
  const choreography = useRef([]);
  const startTime = useRef(null);
  const timerRef = useRef(null);
  const imagesRef = useRef([]);

  // Stabilize images array — only change when URLs actually differ
  const stableImages = useMemo(() => {
    const key = (images || []).join('|');
    return { key, list: images || [] };
  }, [(images || []).join('|')]);

  // Keep ref in sync for interval callback
  useEffect(() => {
    imagesRef.current = stableImages.list;
  }, [stableImages.key]);

  const recordEvent = useCallback((imageUrl, index) => {
    if (!startTime.current) startTime.current = Date.now();
    const event = {
      imageUrl,
      imageIndex: index,
      timestamp: Date.now() - startTime.current,
      fadeDuration: FADE_DURATION,
    };
    choreography.current.push(event);
    onChoreographyUpdate?.(choreography.current);
  }, [onChoreographyUpdate]);

  // Reset when images actually change (new track)
  useEffect(() => {
    const imgs = stableImages.list;
    if (!imgs.length) return;

    imgIndex.current = 0;
    startTime.current = Date.now();
    choreography.current = [];

    // Set first image on layer 0
    setLayerImages([imgs[0], null]);
    setLayerOpacity([1, 0]);
    setActiveLayer(0);
    recordEvent(imgs[0], 0);

    if (imgs.length <= 1) return;

    timerRef.current = setInterval(() => {
      const current = imagesRef.current;
      if (!current.length) return;
      imgIndex.current = (imgIndex.current + 1) % current.length;
      const nextImg = current[imgIndex.current];

      setActiveLayer(prev => {
        const next = prev === 0 ? 1 : 0;
        setLayerImages(prev_imgs => {
          const updated = [...prev_imgs];
          updated[next] = nextImg;
          return updated;
        });
        setLayerOpacity(prev === 0 ? [0, 1] : [1, 0]);
        return next;
      });

      recordEvent(nextImg, imgIndex.current);
    }, SLIDE_DURATION);

    return () => clearInterval(timerRef.current);
  }, [stableImages.key, recordEvent]);

  if (!stableImages.list.length) return null;

  const noVideoClass = hasVideo ? '' : ' no-video';
  const maxOpacity = hasVideo ? 0.12 : 0.45;

  return (
    <>
      <div
        className={`artist-bg-layer${noVideoClass}`}
        style={{
          backgroundImage: layerImages[0] ? `url(${layerImages[0]})` : 'none',
          opacity: layerOpacity[0] * maxOpacity,
        }}
      />
      <div
        className={`artist-bg-layer${noVideoClass}`}
        style={{
          backgroundImage: layerImages[1] ? `url(${layerImages[1]})` : 'none',
          opacity: layerOpacity[1] * maxOpacity,
        }}
      />
    </>
  );
}

/**
 * Get the current choreography data for saving.
 * Called from parent to export.
 */
export function buildChoreographyPayload(choreographyEvents, trackInfo, images) {
  return {
    version: 1,
    track: {
      artist: trackInfo?.artist || '',
      title: trackInfo?.title || '',
      album: trackInfo?.album || '',
    },
    images: images || [],
    slideDuration: SLIDE_DURATION,
    fadeDuration: FADE_DURATION,
    events: choreographyEvents,
    createdAt: new Date().toISOString(),
  };
}
