import { useEffect, useRef } from 'react';
import { API_BASE } from '../config';

// Player-mode fallback for songs YouTube refuses to embed.
// We already downloaded the file, so play our own copy instead of skipping.
// Deliberately plain: no FX, no canvas — this exists to make the song audible.
// Exposes the same controls contract as YouTubeBackground so PlayerControls
// does not care which one is driving.
export default function LocalVideoPlayer({
  videoId,
  volume = 1,
  controlsRef,
  onState,
  onEnded,
  onUnavailable,
}) {
  const videoRef = useRef(null);
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      play: () => videoRef.current?.play().catch(() => {}),
      pause: () => videoRef.current?.pause(),
      seek: (t) => {
        const v = videoRef.current;
        if (v) v.currentTime = Math.max(0, Number(t) || 0);
      },
      setVolume: (x) => {
        volumeRef.current = Math.max(0, Math.min(1, Number(x) || 0));
        const v = videoRef.current;
        if (v) {
          v.muted = false;
          v.volume = volumeRef.current;
        }
      },
      getState: () => {
        const v = videoRef.current;
        if (!v) return { playing: false, currentTime: 0, duration: 0, volume: volumeRef.current };
        return {
          playing: !v.paused && !v.ended,
          currentTime: v.currentTime || 0,
          duration: Number.isFinite(v.duration) ? v.duration : 0,
          volume: volumeRef.current,
        };
      },
    };
    return () => { controlsRef.current = null; };
  }, [controlsRef]);

  // Same 250ms cadence as the YouTube player so the seek bar behaves identically.
  useEffect(() => {
    if (!videoId) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      onState?.({
        playing: !v.paused && !v.ended,
        currentTime: v.currentTime || 0,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        volume: volumeRef.current,
      });
    }, 250);
    return () => clearInterval(id);
  }, [videoId, onState]);

  if (!videoId) return null;

  return (
    <div className="local-video-layer">
      <video
        ref={videoRef}
        src={`${API_BASE}/media/videos/${videoId}.mp4`}
        autoPlay
        playsInline
        onLoadedData={(e) => {
          const v = e.currentTarget;
          v.muted = false;
          v.volume = volumeRef.current;
          v.play().catch(() => {});
        }}
        onEnded={() => onEnded?.()}
        // No file on disk (404) or an unreadable one — fall back to skipping.
        onError={() => onUnavailable?.(videoId)}
      />
    </div>
  );
}
