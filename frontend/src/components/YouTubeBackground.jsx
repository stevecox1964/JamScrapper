import { useEffect, useRef, useState } from 'react';

let apiLoaded = false;
let apiReady = false;
const readyCallbacks = [];

function loadYouTubeAPI() {
  if (apiLoaded) return;
  apiLoaded = true;

  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    apiReady = true;
    readyCallbacks.forEach(cb => cb());
    readyCallbacks.length = 0;
    if (prev) prev();
  };

  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(script);
}

function whenReady(cb) {
  if (apiReady) cb();
  else readyCallbacks.push(cb);
}

function isPlayerAlive(player) {
  try {
    const iframe = player.getIframe?.();
    return iframe && document.contains(iframe);
  } catch (_) {
    return false;
  }
}

export default function YouTubeBackground({ videoId, downloadStatus }) {
  const ytTargetRef = useRef(null);
  const playerRef = useRef(null);
  const currentIdRef = useRef('');
  const videoElRef = useRef(null);
  const [localReady, setLocalReady] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);

  const hasLocal = downloadStatus?.state === 'completed' && videoId && !localFailed;
  const showLocal = hasLocal && localReady;

  useEffect(() => {
    loadYouTubeAPI();
  }, []);

  useEffect(() => {
    setLocalReady(false);
    setLocalFailed(false);
  }, [videoId]);

  // Pause/resume YouTube when switching to/from local video
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !isPlayerAlive(p)) return;
    try {
      if (showLocal) p.pauseVideo();
      else p.playVideo();
    } catch (_) {}
  }, [showLocal]);

  // YouTube IFrame — create player once, swap videos via loadVideoById
  useEffect(() => {
    if (!videoId) return;
    if (videoId === currentIdRef.current) return;
    currentIdRef.current = videoId;

    // If player exists and its iframe is still in the DOM, just swap the video
    if (playerRef.current && isPlayerAlive(playerRef.current)) {
      playerRef.current.loadVideoById(videoId);
      return;
    }

    // Player is missing or stale — create a new one
    playerRef.current = null;

    whenReady(() => {
      if (!ytTargetRef.current) return;
      playerRef.current = new window.YT.Player(ytTargetRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          showinfo: 0,
          rel: 0,
          loop: 1,
          playlist: videoId,
          modestbranding: 1,
          iv_load_policy: 3,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) {
              e.target.seekTo(0);
              e.target.playVideo();
            }
          },
        },
      });
    });
  }, [videoId]);

  // Load local MP4 when download is complete
  useEffect(() => {
    const vid = videoElRef.current;
    if (!vid || !hasLocal || !videoId) return;

    const src = `http://localhost:8766/media/videos/${videoId}.mp4`;
    if (vid.src !== src) {
      vid.src = src;
      vid.load();
    }
  }, [hasLocal, videoId]);

  const handleCanPlay = () => setLocalReady(true);
  const handleError = () => {
    console.warn('Local video failed, staying on YouTube stream');
    setLocalFailed(true);
  };

  // Never unmount — keep DOM alive so the YouTube player survives track switches.
  // Just hide visually when there's no video to show.
  return (
    <div className="youtube-bg" style={{ visibility: videoId ? 'visible' : 'hidden' }}>
      <div className={`yt-layer${showLocal ? ' hidden' : ''}`}>
        <div ref={ytTargetRef} />
      </div>

      <video
        ref={videoElRef}
        muted
        loop
        playsInline
        autoPlay
        className="local-video"
        style={{ opacity: showLocal ? 1 : 0 }}
        onCanPlay={handleCanPlay}
        onError={handleError}
      />
    </div>
  );
}
