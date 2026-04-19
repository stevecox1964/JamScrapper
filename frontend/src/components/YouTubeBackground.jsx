import { useEffect, useRef, useState } from 'react';

let apiLoaded = false;
let apiReady = false;
const readyCallbacks = [];
let readinessPollId = null;

function flushReadyCallbacks() {
  apiReady = true;
  readyCallbacks.splice(0).forEach(cb => cb());
}

function loadYouTubeAPI() {
  // If API already exists (e.g. after hot reload), mark ready immediately.
  if (window.YT?.Player) {
    flushReadyCallbacks();
    return;
  }

  if (apiLoaded) return;
  apiLoaded = true;

  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    flushReadyCallbacks();
    if (prev) prev();
  };

  const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
  if (!existing) {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  }

  // Fallback: some environments may have YT loaded without invoking callback.
  readinessPollId = window.setInterval(() => {
    if (window.YT?.Player) {
      if (readinessPollId) window.clearInterval(readinessPollId);
      readinessPollId = null;
      flushReadyCallbacks();
    }
  }, 100);
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

export default function YouTubeBackground({
  appMode = 'live',
  videoId,
  playerTrack,
  nextPlayerTrack,
  onTrackEnded,
  onPlayerState,
  controlsRef,
}) {
  const liveTargetRef = useRef(null);
  const playerTargetRef = useRef(null);
  const livePlayerRef = useRef(null);
  const playerPlayerRef = useRef(null);
  const liveIdRef = useRef('');
  const playerIdRef = useRef('');
  const playerTimerRef = useRef(null);
  const [fadeOut, setFadeOut] = useState(0);
  const [liveFade, setLiveFade] = useState(false);
  const FADE_DURATION = 3; // seconds before end to start fading

  const isPlayerMode = appMode === 'player';
  const playerVideoId = playerTrack?.videoId || '';
  const effectiveVisibility = isPlayerMode ? Boolean(playerVideoId) : Boolean(videoId);

  useEffect(() => {
    loadYouTubeAPI();
  }, []);

  // Expose YouTube player controls to parent
  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      play: () => {
        const p = playerPlayerRef.current;
        if (p && isPlayerAlive(p)) p.playVideo?.();
      },
      pause: () => {
        const p = playerPlayerRef.current;
        if (p && isPlayerAlive(p)) p.pauseVideo?.();
      },
      seek: (timeSec) => {
        const p = playerPlayerRef.current;
        if (p && isPlayerAlive(p)) p.seekTo?.(Math.max(0, Number(timeSec) || 0), true);
      },
      setVolume: (v) => {
        const p = playerPlayerRef.current;
        if (p && isPlayerAlive(p)) p.setVolume?.(Math.max(0, Math.min(100, Math.round((Number(v) || 0) * 100))));
      },
      getState: () => {
        const p = playerPlayerRef.current;
        if (!p || !isPlayerAlive(p)) return { playing: false, currentTime: 0, duration: 0, volume: 1 };
        try {
          return {
            playing: p.getPlayerState?.() === window.YT.PlayerState.PLAYING,
            currentTime: Number(p.getCurrentTime?.() || 0),
            duration: Number(p.getDuration?.() || 0),
            volume: (Number(p.getVolume?.() || 100)) / 100,
          };
        } catch (_) {
          return { playing: false, currentTime: 0, duration: 0, volume: 1 };
        }
      },
    };
    return () => { controlsRef.current = null; };
  }, [controlsRef]);

  // LIVE mode: YouTube IFrame — muted, looping background
  useEffect(() => {
    if (isPlayerMode || !videoId) return;
    if (videoId === liveIdRef.current && livePlayerRef.current && isPlayerAlive(livePlayerRef.current)) return;
    liveIdRef.current = videoId;

    if (livePlayerRef.current && isPlayerAlive(livePlayerRef.current)) {
      livePlayerRef.current.loadVideoById(videoId);
      return;
    }

    livePlayerRef.current = null;

    whenReady(() => {
      if (!liveTargetRef.current) return;
      livePlayerRef.current = new window.YT.Player(liveTargetRef.current, {
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
          onReady: (e) => e.target.playVideo(),
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) {
              e.target.seekTo(0);
              e.target.playVideo();
            }
          },
        },
      });
    });
  }, [videoId, isPlayerMode]);

  // Pause/resume live player when switching modes
  useEffect(() => {
    const p = livePlayerRef.current;
    if (!p || !isPlayerAlive(p)) return;
    try {
      if (isPlayerMode) p.pauseVideo();
      else p.playVideo();
    } catch (_) {}
  }, [isPlayerMode]);

  // Fade the live layer during track transitions:
  // when the new track arrives but its YouTube video hasn't been found yet
  // (videoId goes empty), dim the previous video instead of letting it
  // play on at full opacity. Restore when the new video loads.
  useEffect(() => {
    if (isPlayerMode) return;
    if (videoId) {
      setLiveFade(false);
    } else if (liveIdRef.current) {
      setLiveFade(true);
    }
  }, [videoId, isPlayerMode]);

  // PLAYER mode: YouTube IFrame — unmuted, no loop, track ended detection
  useEffect(() => {
    if (!isPlayerMode || !playerVideoId) return;

    // If same video, just resume
    if (playerVideoId === playerIdRef.current && playerPlayerRef.current && isPlayerAlive(playerPlayerRef.current)) {
      playerPlayerRef.current.playVideo?.();
      return;
    }
    playerIdRef.current = playerVideoId;
    setFadeOut(0);

    if (playerPlayerRef.current && isPlayerAlive(playerPlayerRef.current)) {
      playerPlayerRef.current.loadVideoById(playerVideoId);
      return;
    }

    playerPlayerRef.current = null;

    whenReady(() => {
      if (!playerTargetRef.current) return;
      playerPlayerRef.current = new window.YT.Player(playerTargetRef.current, {
        videoId: playerVideoId,
        playerVars: {
          autoplay: 1,
          mute: 0,
          controls: 0,
          showinfo: 0,
          rel: 0,
          loop: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => e.target.playVideo(),
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) {
              onTrackEnded?.();
            }
          },
        },
      });
    });
  }, [playerVideoId, isPlayerMode, onTrackEnded]);

  // Pause player IFrame when leaving player mode
  useEffect(() => {
    if (isPlayerMode) return;
    const p = playerPlayerRef.current;
    if (p && isPlayerAlive(p)) {
      try { p.pauseVideo(); } catch (_) {}
    }
  }, [isPlayerMode]);

  // Player mode: poll for time updates + fade-out
  useEffect(() => {
    if (playerTimerRef.current) {
      clearInterval(playerTimerRef.current);
      playerTimerRef.current = null;
    }
    if (!isPlayerMode || !playerVideoId) return;

    playerTimerRef.current = setInterval(() => {
      const p = playerPlayerRef.current;
      if (!p || !isPlayerAlive(p)) return;
      try {
        const currentTime = Number(p.getCurrentTime?.() || 0);
        const duration = Number(p.getDuration?.() || 0);
        const volume = (Number(p.getVolume?.() || 100)) / 100;
        const playing = p.getPlayerState?.() === window.YT.PlayerState.PLAYING;
        const remaining = duration - currentTime;

        // Fade out in last FADE_DURATION seconds
        if (duration > FADE_DURATION && remaining <= FADE_DURATION && remaining > 0) {
          const fade = 1 - remaining / FADE_DURATION;
          setFadeOut(fade);
          // Fade audio volume
          const fadedVol = Math.max(0, Math.round((1 - fade) * 100));
          p.setVolume(fadedVol);
        } else if (remaining > FADE_DURATION) {
          setFadeOut(0);
        }

        onPlayerState?.({ playing, currentTime, duration, volume });
      } catch (_) {}
    }, 250);

    return () => {
      if (playerTimerRef.current) {
        clearInterval(playerTimerRef.current);
        playerTimerRef.current = null;
      }
    };
  }, [isPlayerMode, playerVideoId, onPlayerState]);

  const showLive = !isPlayerMode;
  const showPlayer = isPlayerMode && Boolean(playerVideoId);

  return (
    <div className="youtube-bg" style={{ visibility: effectiveVisibility ? 'visible' : 'hidden' }}>
      <div
        className={`yt-layer${showLive ? '' : ' hidden'}`}
        style={{ opacity: liveFade ? 0.2 : 1, transition: 'opacity 0.6s ease' }}
      >
        <div ref={liveTargetRef} />
      </div>

      <div
        className={`yt-layer${showPlayer ? '' : ' hidden'}`}
        style={{ opacity: showPlayer ? 1 - fadeOut : 0, transition: 'opacity 0.3s ease' }}
      >
        <div ref={playerTargetRef} />
      </div>
    </div>
  );
}
