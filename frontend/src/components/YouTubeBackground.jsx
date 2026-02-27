import { useEffect, useRef } from 'react';

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

export default function YouTubeBackground({ videoId }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const currentIdRef = useRef('');

  useEffect(() => {
    loadYouTubeAPI();
  }, []);

  useEffect(() => {
    if (!videoId || videoId === currentIdRef.current) return;
    currentIdRef.current = videoId;

    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId);
      return;
    }

    whenReady(() => {
      if (!containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
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
          onReady: (e) => {
            e.target.setLoop(true);
          },
          onStateChange: (e) => {
            // Loop: when video ends, restart
            if (e.data === window.YT.PlayerState.ENDED) {
              e.target.seekTo(0);
              e.target.playVideo();
            }
          },
        },
      });
    });

    return () => {
      if (playerRef.current?.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId]);

  if (!videoId) return null;

  return (
    <div className="youtube-bg">
      <div ref={containerRef} />
    </div>
  );
}
