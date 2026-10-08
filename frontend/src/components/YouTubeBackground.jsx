import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../config';

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

// YouTube remembers the viewer's caption preference and can turn captions on by
// itself. Unloading the caption modules switches them off for this player.
function hideCaptions(player) {
  try { player.unloadModule('captions'); } catch (_) {}
  try { player.unloadModule('cc'); } catch (_) {}
}

function applyVolume(player, volume) {
  if (!player || !isPlayerAlive(player)) return;
  try {
    player.unMute?.();
    player.setVolume?.(Math.max(0, Math.min(100, Math.round((Number(volume) || 0) * 100))));
  } catch (_) {}
}

// [VIDSWAP] lines also go to the backend, which appends them to
// backend/data/client.log, so they can be read without the browser console.
function vidlog(line) {
  console.log(line);
  fetch(`${API_BASE}/client-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
  }).catch(() => {});
}

const LIVE_CHECK_MS = 4000;

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
  const loggedEmptyForRef = useRef(null);
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
  const onLiveVideoErrorRef = useRef(onLiveVideoError);
  const liveCheckTimerRef = useRef(null);
  onLiveVideoErrorRef.current = onLiveVideoError;
  onTrackEndedRef.current = onTrackEnded;
  onPlayerVideoErrorRef.current = onPlayerVideoError;
  onPlayerStateRef.current = onPlayerState;
  const [fadeOut, setFadeOut] = useState(0);
  const [liveFade, setLiveFade] = useState(false);
  // YouTube paints its own big play button in the middle of a paused embed,
  // and nothing outside the iframe can hide it. So the whole video fades out
  // while paused and the button goes with it.
  const [playerPaused, setPlayerPaused] = useState(false);
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

  // Builds the live player in a fresh element. YT.Player swaps the element
  // it is given for an iframe, so reusing liveTargetRef's div directly left a
  // detached node to build into on any rebuild. Any old player is destroyed.
  const buildLivePlayer = (id) => {
    const container = liveTargetRef.current;
    if (!container) return;
    try { livePlayerRef.current?.destroy?.(); } catch (_) {}
    container.innerHTML = '';
    const mount = document.createElement('div');
    container.appendChild(mount);
    livePlayerRef.current = new window.YT.Player(mount, {
      videoId: id,
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 0,
        showinfo: 0,
        rel: 0,
        // No loop/playlist here: they pin a one-item playlist to the FIRST
        // videoId, which can pull the player back to the old song after
        // loadVideoById(). The ENDED handler below does the looping instead.
        modestbranding: 1,
        iv_load_policy: 3,
        cc_load_policy: 0,
        disablekb: 1,
        fs: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (e) => { hideCaptions(e.target); e.target.playVideo(); },
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.PLAYING) hideCaptions(e.target);
          let playingId = '';
          try { playingId = e.target.getVideoData?.()?.video_id || ''; } catch (_) {}
          vidlog(`[VIDSWAP] live state=${e.data} wanted='${liveIdRef.current}' actually='${playingId}'`);
          if (e.data === window.YT.PlayerState.ENDED) {
            e.target.seekTo(0);
            e.target.playVideo();
          }
        },
        onError: (e) => {
          const code = Number(e?.data || 0);
          if (UNPLAYABLE_ERROR_CODES.has(code)) {
            const badId = liveIdRef.current;
            vidlog(`[YT] Live video ${badId} unplayable (error ${code}) — flipping to synthetic`);
            onLiveVideoErrorRef.current?.(badId, code);
          }
        },
      },
    });
  };

  // A long-open page can end up showing the old song's video after a switch,
  // while a fresh page works. So a few seconds after each switch, check what
  // the player really has, and rebuild it once if it is wrong.
  const scheduleLiveCheck = (id, canRebuild) => {
    clearTimeout(liveCheckTimerRef.current);
    liveCheckTimerRef.current = setTimeout(() => {
      if (liveIdRef.current !== id) return; // the song moved on again
      const p = livePlayerRef.current;
      const alive = Boolean(p && isPlayerAlive(p));
      let playingId = '';
      try { playingId = p?.getVideoData?.()?.video_id || ''; } catch (_) {}
      if (alive && playingId === id) {
        vidlog(`[VIDSWAP] check ok: '${id}'`);
        return;
      }
      if (!canRebuild) {
        vidlog(`[VIDSWAP] check FAILED again: wanted '${id}' player has '${playingId}' alive=${alive} — giving up`);
        return;
      }
      vidlog(`[VIDSWAP] check FAILED: wanted '${id}' player has '${playingId}' alive=${alive} — rebuilding`);
      whenReady(() => {
        buildLivePlayer(id);
        scheduleLiveCheck(id, false);
      });
    }, LIVE_CHECK_MS);
  };

  useEffect(() => () => clearTimeout(liveCheckTimerRef.current), []);

  // LIVE mode: YouTube IFrame — muted, looping background
  useEffect(() => {
    if (isPlayerMode) return;
    if (!videoId) {
      if (loggedEmptyForRef.current !== liveIdRef.current) {
        loggedEmptyForRef.current = liveIdRef.current;
        vidlog(`[VIDSWAP] no videoId yet — still showing '${liveIdRef.current}'`);
      }
      return;
    }
    loggedEmptyForRef.current = null;
    if (videoId === liveIdRef.current && livePlayerRef.current && isPlayerAlive(livePlayerRef.current)) return;
    vidlog(`[VIDSWAP] videoId changed: '${liveIdRef.current}' -> '${videoId}' hidden=${document.hidden}`);
    liveIdRef.current = videoId;

    // New song: throw the old player away and build a fresh one. Reusing it
    // with loadVideoById() left long-open pages stuck on the old video.
    vidlog(`[VIDSWAP] new song — building a fresh player for '${videoId}'`);
    whenReady(() => {
      if (liveIdRef.current !== videoId) return; // the song moved on again
      buildLivePlayer(videoId);
      scheduleLiveCheck(videoId, true);
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
          cc_load_policy: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            hideCaptions(e.target);
            applyVolume(e.target, userVolumeRef.current);
            e.target.playVideo();
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) hideCaptions(e.target);
            setPlayerPaused(e.data === window.YT.PlayerState.PAUSED);
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
        style={{ opacity: showPlayer && !playerPaused ? 1 - fadeOut : 0, transition: 'opacity 0.3s ease' }}
      >
        <div ref={playerTargetRef} />
      </div>
    </div>
  );
}
