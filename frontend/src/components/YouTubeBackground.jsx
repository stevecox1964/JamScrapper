import { useEffect, useRef, useState } from 'react';
import { videoUrl } from '../config';

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
  downloadStatus,
  playerTrack,
  nextPlayerTrack,
  onTrackEnded,
  onPlayerState,
  controlsRef,
}) {
  const ytTargetRef = useRef(null);
  const playerRef = useRef(null);
  const currentIdRef = useRef('');
  const liveLocalVideoRef = useRef(null);
  const playerVideoARef = useRef(null);
  const playerVideoBRef = useRef(null);
  const transitionTokenRef = useRef(0);
  const activeSlotRef = useRef('a');
  const currentPlayerIdRef = useRef('');
  const [localReady, setLocalReady] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  const [playerActiveSlot, setPlayerActiveSlot] = useState('a');
  const [fadeOut, setFadeOut] = useState(0); // 0 = full, 1 = fully faded
  const FADE_DURATION = 3; // seconds before end to start fading

  const isPlayerMode = appMode === 'player';
  const playerVideoId = playerTrack?.videoId || '';
  const nextPlayerVideoId = nextPlayerTrack?.videoId || '';
  const hasLocalLive = downloadStatus?.state === 'completed' && videoId && !localFailed;
  const showLocalLive = hasLocalLive && localReady;
  const effectiveVisibility = isPlayerMode ? Boolean(playerVideoId) : Boolean(videoId);

  useEffect(() => {
    loadYouTubeAPI();
  }, []);

  useEffect(() => {
    setLocalReady(false);
    setLocalFailed(false);
  }, [videoId, playerVideoId]);

  useEffect(() => {
    if (isPlayerMode) return;
    playerVideoARef.current?.pause?.();
    playerVideoBRef.current?.pause?.();
  }, [isPlayerMode]);

  // Expose local video controls to parent
  useEffect(() => {
    if (!controlsRef) return;
    const getActivePlayerEl = () => {
      if (!isPlayerMode) return liveLocalVideoRef.current;
      return activeSlotRef.current === 'a' ? playerVideoARef.current : playerVideoBRef.current;
    };
    controlsRef.current = {
      play: () => getActivePlayerEl()?.play?.().catch(() => {}),
      pause: () => getActivePlayerEl()?.pause?.(),
      seek: (timeSec) => {
        const v = getActivePlayerEl();
        if (!v) return;
        v.currentTime = Math.max(0, Number(timeSec) || 0);
      },
      setVolume: (v) => {
        const el = getActivePlayerEl();
        if (!el) return;
        el.volume = Math.max(0, Math.min(1, Number(v) || 0));
      },
      getState: () => {
        const v = getActivePlayerEl();
        if (!v) return { playing: false, currentTime: 0, duration: 0, volume: 1 };
        return {
          playing: !v.paused && !v.ended,
          currentTime: Number(v.currentTime || 0),
          duration: Number(v.duration || 0),
          volume: Number(v.volume || 1),
        };
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, isPlayerMode]);

  // Pause/resume YouTube when switching to/from local video in LIVE mode
  useEffect(() => {
    if (isPlayerMode) return;
    const p = playerRef.current;
    if (!p || !isPlayerAlive(p)) return;
    try {
      if (showLocalLive) p.pauseVideo();
      else p.playVideo();
    } catch (_) {}
  }, [showLocalLive, isPlayerMode]);

  // LIVE mode: YouTube IFrame — create player once, swap videos via loadVideoById
  useEffect(() => {
    if (isPlayerMode || !videoId) return;
    if (videoId === currentIdRef.current) return;
    currentIdRef.current = videoId;

    if (playerRef.current && isPlayerAlive(playerRef.current)) {
      playerRef.current.loadVideoById(videoId);
      return;
    }

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
          onReady: (e) => {
            // Ensure immediate playback on initial load.
            e.target.playVideo();
          },
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

  // LIVE mode: load local MP4 when download is complete (muted + crossfade)
  useEffect(() => {
    if (isPlayerMode) return;
    const vid = liveLocalVideoRef.current;
    if (!vid || !hasLocalLive || !videoId) return;

    const src = videoUrl(videoId);
    if (vid.src !== src) {
      vid.src = src;
      vid.load();
    }
    vid.muted = true;
  }, [hasLocalLive, videoId, isPlayerMode]);

  // Player mode: preload upcoming track on inactive element.
  useEffect(() => {
    if (!isPlayerMode || !nextPlayerVideoId) return;
    const inactive = activeSlotRef.current === 'a' ? playerVideoBRef.current : playerVideoARef.current;
    if (!inactive) return;
    const preloadSrc = videoUrl(nextPlayerVideoId);
    if (inactive.dataset.src !== preloadSrc) {
      inactive.dataset.src = preloadSrc;
      inactive.src = preloadSrc;
      inactive.preload = 'auto';
      inactive.load();
    }
  }, [isPlayerMode, nextPlayerVideoId, playerActiveSlot]);

  // Player mode: instant transition using active+preload video elements.
  useEffect(() => {
    if (!isPlayerMode || !playerVideoId) return;
    if (currentPlayerIdRef.current === playerVideoId) {
      const active = activeSlotRef.current === 'a' ? playerVideoARef.current : playerVideoBRef.current;
      active?.play?.().catch(() => {});
      return;
    }
    currentPlayerIdRef.current = playerVideoId;
    const token = ++transitionTokenRef.current;
    const nextSlot = activeSlotRef.current === 'a' ? 'b' : 'a';
    const incoming = nextSlot === 'a' ? playerVideoARef.current : playerVideoBRef.current;
    const outgoing = activeSlotRef.current === 'a' ? playerVideoARef.current : playerVideoBRef.current;
    if (!incoming) return;

    const src = videoUrl(playerVideoId);
    const swapNow = () => {
      if (transitionTokenRef.current !== token) return;
      incoming.currentTime = 0;
      incoming.muted = false;
      incoming.volume = 1;
      setFadeOut(0);
      incoming.play().catch(() => {});
      outgoing?.pause?.();
      activeSlotRef.current = nextSlot;
      setPlayerActiveSlot(nextSlot);
      onPlayerState?.({
        playing: true,
        currentTime: Number(incoming.currentTime || 0),
        duration: Number(incoming.duration || 0),
        volume: Number(incoming.volume || 1),
      });
    };

    if (incoming.dataset.src !== src) {
      incoming.dataset.src = src;
      incoming.src = src;
      incoming.preload = 'auto';
      incoming.load();
    }

    if (incoming.readyState >= 2) {
      swapNow();
      return;
    }

    const onCanPlay = () => swapNow();
    incoming.addEventListener('canplay', onCanPlay, { once: true });
    return () => incoming.removeEventListener('canplay', onCanPlay);
  }, [isPlayerMode, playerVideoId, onPlayerState]);

  const handleLiveCanPlay = () => {
    setLocalReady(true);
  };

  const handleLiveError = () => {
    if (!isPlayerMode) {
      console.warn('Local video failed, staying on YouTube stream');
      setLocalFailed(true);
    }
  };

  const handlePlayerError = (e) => {
    const vid = e.target;
    if (!vid?.src) return;
    console.warn('Player video failed to load, skipping to next track:', vid.src);
    // Skip to next track when local MP4 fails in player mode
    if (isPlayerMode) onTrackEnded?.();
  };

  const handleTimeUpdate = () => {
    // Determine which video element to check
    let v;
    if (isPlayerMode) {
      v = activeSlotRef.current === 'a' ? playerVideoARef.current : playerVideoBRef.current;
    } else {
      v = liveLocalVideoRef.current;
    }
    if (!v) return;
    const currentTime = Number(v.currentTime || 0);
    const duration = Number(v.duration || 0);
    const remaining = duration - currentTime;

    // Fade out video + audio in last FADE_DURATION seconds
    if (duration > FADE_DURATION && remaining <= FADE_DURATION && remaining > 0) {
      const fade = 1 - remaining / FADE_DURATION; // 0→1
      setFadeOut(fade);
      if (!v.muted) v.volume = Math.max(0, 1 - fade);
    } else if (fadeOut !== 0) {
      setFadeOut(0);
    }

    if (isPlayerMode) {
      onPlayerState?.({
        playing: !v.paused && !v.ended,
        currentTime,
        duration,
        volume: Number(v.volume || 1),
      });
    }
  };

  const showYouTubeLayer = !isPlayerMode && !showLocalLive;
  const showLiveLocalLayer = !isPlayerMode && showLocalLive;
  const showPlayerAVideo = isPlayerMode && playerActiveSlot === 'a' && Boolean(playerVideoId);
  const showPlayerBVideo = isPlayerMode && playerActiveSlot === 'b' && Boolean(playerVideoId);

  return (
    <div className="youtube-bg" style={{ visibility: effectiveVisibility ? 'visible' : 'hidden' }}>
      <div className={`yt-layer${showYouTubeLayer ? '' : ' hidden'}`}>
        <div ref={ytTargetRef} />
      </div>

      {/* Live mode local fallback video */}
      <video
        ref={liveLocalVideoRef}
        muted
        loop
        playsInline
        autoPlay
        className="local-video"
        style={{ opacity: showLiveLocalLayer ? 1 - fadeOut : 0, transition: 'opacity 0.15s ease' }}
        onCanPlay={handleLiveCanPlay}
        onError={handleLiveError}
        onTimeUpdate={handleTimeUpdate}
      />

      {/* Player mode active/preload pair */}
      <video
        ref={playerVideoARef}
        muted={false}
        loop={false}
        playsInline
        className="local-video"
        style={{ opacity: showPlayerAVideo ? 1 - fadeOut : 0, transition: 'opacity 0.15s ease' }}
        onEnded={() => {
          if (isPlayerMode && playerActiveSlot === 'a') onTrackEnded?.();
        }}
        onError={handlePlayerError}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handleTimeUpdate}
        onPause={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
      />
      <video
        ref={playerVideoBRef}
        muted={false}
        loop={false}
        playsInline
        className="local-video"
        style={{ opacity: showPlayerBVideo ? 1 - fadeOut : 0, transition: 'opacity 0.15s ease' }}
        onEnded={() => {
          if (isPlayerMode && playerActiveSlot === 'b') onTrackEnded?.();
        }}
        onError={handlePlayerError}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handleTimeUpdate}
        onPause={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
      />
    </div>
  );
}
