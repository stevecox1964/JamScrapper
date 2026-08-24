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

function applyVolume(player, volume) {
  if (!player || !isPlayerAlive(player)) return;
  try {
    player.unMute?.();
    player.setVolume?.(Math.max(0, Math.min(100, Math.round((Number(volume) || 0) * 100))));
  } catch (_) {}
}

// YouTube IFrame error codes we treat as "the video can't actually play":
// 100 = removed/private, 101 & 150 = embedding disabled by uploader or owner.
export const UNPLAYABLE_ERROR_CODES = new Set([100, 101, 150]);

export default function YouTubeBackground({
  appMode = 'live',
  videoId,
  playerTrack,
  nextPlayerTrack,
  onTrackEnded,
  onPlayerState,
  onLiveVideoError,
  onPlayerVideoError,
  controlsRef,
}) {
  const liveTargetRef = useRef(null);
  const playerTargetRef = useRef(null);
  const livePlayerRef = useRef(null);
  const playerPlayerRef = useRef(null);
  const liveIdRef = useRef('');
  const playerIdRef = useRef('');
  const playerTimerRef = useRef(null);
  // Desired playback volume (0-1). The end-of-track fade lowers the YouTube
  // player's volume, so we keep the intended level here and restore it.
  const userVolumeRef = useRef(1);
  // App.jsx defines these inline, so they are a new function on every render.
  // Depending on them directly re-ran the player effect on every render, and
  // that effect calls playVideo() -- which un-paused the track ~4x a second.
  const onTrackEndedRef = useRef(onTrackEnded);
  const onPlayerVideoErrorRef = useRef(onPlayerVideoError);
  const onPlayerStateRef = useRef(onPlayerState);
  onTrackEndedRef.current = onTrackEnded;
  onPlayerVideoErrorRef.current = onPlayerVideoError;
  onPlayerStateRef.current = onPlayerState;
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
        userVolumeRef.current = Math.max(0, Math.min(1, Number(v) || 0));
        applyVolume(playerPlayerRef.current, userVolumeRef.current);
      },
      getState: () => {
        const p = playerPlayerRef.current;
        if (!p || !isPlayerAlive(p)) return { playing: false, currentTime: 0, duration: 0, volume: 1 };
        try {
          return {
            playing: p.getPlayerState?.() === window.YT.PlayerState.PLAYING,
            currentTime: Number(p.getCurrentTime?.() || 0),
            duration: Number(p.getDuration?.() || 0),
            volume: userVolumeRef.current,
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
          onError: (e) => {
            const code = Number(e?.data || 0);
            if (UNPLAYABLE_ERROR_CODES.has(code)) {
              const badId = liveIdRef.current;
              console.warn(`[YT] Live video ${badId} unplayable (error ${code}) — flipping to synthetic`);
              onLiveVideoError?.(badId, code);
            }
          },
        },
      });
    });
  }, [videoId, isPlayerMode, onLiveVideoError]);

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
      const p = playerPlayerRef.current;
      applyVolume(p, userVolumeRef.current);
      // Only resume a player that actually stopped on its own. Calling
      // playVideo() unconditionally overrode the user's Pause button.
      const state = p.getPlayerState?.();
      const PAUSED = window.YT?.PlayerState?.PAUSED;
      if (state !== PAUSED) p.playVideo?.();
      return;
    }
    playerIdRef.current = playerVideoId;
    setFadeOut(0);

    if (playerPlayerRef.current && isPlayerAlive(playerPlayerRef.current)) {
      playerPlayerRef.current.loadVideoById(playerVideoId);
      applyVolume(playerPlayerRef.current, userVolumeRef.current);
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
          onReady: (e) => {
            applyVolume(e.target, userVolumeRef.current);
            e.target.playVideo();
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) {
              onTrackEndedRef.current?.();
            }
          },
          // Player mode had no error handler at all: an embed-blocked video
          // left the player sitting on a dead frame forever. Any error code
          // here means this track will not play, so move on.
          onError: (e) => {
            const code = Number(e?.data || 0);
            const badId = playerIdRef.current;
            console.warn(`[YT] Player video ${badId} failed (error ${code}) — skipping`);
            onPlayerVideoErrorRef.current?.(badId, code);
          },
        },
      });
    });
  }, [playerVideoId, isPlayerMode]);

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
          // Undo any leftover fade volume from the previous track.
          const target = Math.round(userVolumeRef.current * 100);
          if (p.isMuted?.() || Math.abs(Number(p.getVolume?.() ?? target) - target) > 1) {
            applyVolume(p, userVolumeRef.current);
          }
        }

        onPlayerStateRef.current?.({ playing, currentTime, duration, volume: userVolumeRef.current });
      } catch (_) {}
    }, 250);

    return () => {
      if (playerTimerRef.current) {
        clearInterval(playerTimerRef.current);
        playerTimerRef.current = null;
      }
    };
  }, [isPlayerMode, playerVideoId]);

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
