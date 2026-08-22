import { useState, useRef, useEffect } from 'react';
import useAudioWebSocket from './hooks/useAudioWebSocket';
import Visualizer from './components/Visualizer';
import ThreeVisualizer from './components/ThreeVisualizer';
import ModeSelector from './components/ModeSelector';
import TrackInfo from './components/TrackInfo';
import SongHistory from './components/SongHistory';
import PlaylistPanel from './components/PlaylistPanel';
import PlayerControls from './components/PlayerControls';
import LibraryPanel from './components/LibraryPanel';
import YtMissesPanel from './components/YtMissesPanel';
import YouTubeBackground, { UNPLAYABLE_ERROR_CODES } from './components/YouTubeBackground';
import SyntheticVideo from './components/SyntheticVideo';
import LocalVideoFx from './components/LocalVideoFx';
import LocalVideoPlayer from './components/LocalVideoPlayer';
import MediaTextureManager from './utils/mediaTextureManager';
import { WS_URL, API_BASE } from './config';
import './App.css';

const THREE_D_MODES = new Set(['tunnel', 'galaxy', 'terrain', 'starfield']);

export default function App() {
  const [appMode, setAppMode] = useState('live');
  const [mode, setMode] = useState('video');
  const [showHistory, setShowHistory] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showMisses, setShowMisses] = useState(false);
  const [forceSynthetic, setForceSynthetic] = useState(false);
  const [radioOn, setRadioOn] = useState(false);
  const radioOnRef = useRef(false);
  const radioBusyRef = useRef(false);
  // Stops a run of dead videos from spinning the player forever.
  const deadVideoStreakRef = useRef(0);
  const { dataRef, connected, media, historyVersion, refreshMedia } = useAudioWebSocket(WS_URL);
  const mediaManagerRef = useRef(new MediaTextureManager());
  const playerControlsRef = useRef(null);
  const localControlsRef = useRef(null);
  // Set when YouTube refuses to embed a track we have on disk — the local file
  // takes over playback and PlayerControls is pointed at it instead.
  const [localFallbackId, setLocalFallbackId] = useState('');
  const ytErrorCodeRef = useRef(0);
  const playerQueueRef = useRef([]);

  const [playerQueue, setPlayerQueue] = useState([]);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [playerState, setPlayerState] = useState({
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
  });
  const playerStateRestoredRef = useRef(false);

  useEffect(() => {
    if (media) mediaManagerRef.current.update(media);
  }, [media]);

  useEffect(() => {
    return () => mediaManagerRef.current.dispose();
  }, []);

  useEffect(() => {
    playerQueueRef.current = playerQueue;
  }, [playerQueue]);

  useEffect(() => {
    radioOnRef.current = radioOn;
  }, [radioOn]);

  // Every new track starts fresh on YouTube; the local file is only a rescue.
  useEffect(() => {
    setLocalFallbackId('');
    ytErrorCodeRef.current = 0;
  }, [playerIndex, playerQueue]);

  // Restore player state from backend on mount
  useEffect(() => {
    fetch(`${API_BASE}/player-state`)
      .then(r => r.json())
      .then(state => {
        if (state?.queue?.length) {
          setPlayerQueue(state.queue);
          setPlayerIndex(state.queueIndex || 0);
          // Volume is deliberately NOT restored: playback always starts at full.
          playerStateRestoredRef.current = true;
        }
      })
      .catch(() => {});
  }, []);

  // Save player state to backend when queue/index/volume changes
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (!playerQueue.length) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`${API_BASE}/player-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queue: playerQueue,
          queueIndex: playerIndex,
          currentTime: playerState.currentTime,
          volume: playerState.volume,
          playing: playerState.playing,
        }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [playerQueue, playerIndex, playerState.currentTime, playerState.volume]);

  const is3D = THREE_D_MODES.has(mode);
  const currentPlayerTrack = playerQueue[playerIndex] || null;
  const nextPlayerTrack = playerQueue.length > 1
    ? playerQueue[(playerIndex + 1) % playerQueue.length]
    : null;
  const isPlayer = appMode === 'player';
  // Fallback visuals when the embedded video can't show (or the user forces
  // them on). Priority: saved local video + MTV FX > image slideshow.
  const hasRealVideo = Boolean(media?.youtubeVideoId);
  const hasLocalVideo = Boolean(media?.localVideoUrl);
  const showFallback = appMode === 'live' && (media?.youtubeSearchStatus === 'not_found' || forceSynthetic);
  const showLocalVideo = showFallback && hasLocalVideo;
  const showSynthetic = showFallback && !hasLocalVideo;

  const activeControls = () => (
    localFallbackId ? localControlsRef.current : playerControlsRef.current
  );

  const playTrack = (track) => {
    if (!track?.videoId) return;
    setPlayerQueue([track]);
    setPlayerIndex(0);
    setAppMode('player');
  };

  const playFromHistory = (tracks, startIndex = 0) => {
    if (!tracks.length) return;
    setPlayerQueue(tracks);
    setPlayerIndex(startIndex);
    setAppMode('player');
  };

  const switchToPlayer = () => {
    // If already in player mode with a queue, just switch back
    if (playerQueueRef.current.length > 0) {
      setAppMode('player');
      return;
    }
    // Load history and start from the beginning
    fetch(`${API_BASE}/history/playable`)
      .then(r => r.json())
      .then(history => {
        const playable = history.filter(e => e.isPlayable).map(e => ({
          videoId: e.videoId,
          artist: e.artist,
          title: e.title,
          videoTitle: e.videoTitle || e.title || '',
          duration: e.duration || 0,
        }));
        playFromHistory(playable, 0);
      })
      .catch(() => setAppMode('player'));
  };

  const queuePlaylist = (playlist) => {
    const tracks = (playlist?.tracks || []).filter(t => t.videoId);
    if (!tracks.length) return;
    setPlayerQueue(tracks);
    setPlayerIndex(0);
    setAppMode('player');
  };

  // Radio: ask the backend for a genre-drifted random pick, append it, play it.
  const appendRadioTrack = async (seed) => {
    if (radioBusyRef.current) return false;
    radioBusyRef.current = true;
    try {
      const params = new URLSearchParams();
      if (seed?.artist) params.set('artist', seed.artist);
      if (seed?.title) params.set('title', seed.title);
      const res = await fetch(`${API_BASE}/radio/next?${params.toString()}`);
      const data = await res.json();
      const track = data?.track;
      if (!track?.videoId) {
        console.warn('[radio] no track returned:', data?.error || 'unknown reason');
        return false;
      }
      const queue = playerQueueRef.current;
      setPlayerQueue([...queue, track]);
      setPlayerIndex(queue.length);
      return true;
    } catch (e) {
      console.warn('[radio] request failed:', e);
      return false;
    } finally {
      radioBusyRef.current = false;
    }
  };

  const toggleRadio = async () => {
    if (radioOn) {
      setRadioOn(false);
      return;
    }
    const seed = isPlayer
      ? currentPlayerTrack
      : (media?.artist ? { artist: media.artist, title: media.title } : null);
    const ok = await appendRadioTrack(seed);
    if (!ok) return;
    setRadioOn(true);
    setAppMode('player');
  };

  // A song we let finish is the closest thing to a thumbs-up, so it just feeds
  // the mood. A skip is the opposite signal and gets reported before we move on.
  const atEndOfQueue = () => playerIndex >= playerQueueRef.current.length - 1;

  const reportRadio = (path, track, playedSeconds) => {
    if (!track?.videoId) return;
    fetch(`${API_BASE}/radio/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: track.artist || '',
        title: track.title || '',
        videoId: track.videoId,
        playedSeconds: playedSeconds || 0,
      }),
    }).catch(() => {});
  };

  const handleTrackEnded = () => {
    deadVideoStreakRef.current = 0;
    if (radioOnRef.current) {
      reportRadio('finished', currentPlayerTrack, playerState.duration);
    }
    if (radioOnRef.current && atEndOfQueue()) {
      appendRadioTrack(null);
      return;
    }
    nextTrack();
  };

  // A video that refuses to play is not a song you disliked. Move on WITHOUT
  // reporting a skip — recording one would teach Rando to avoid a track you
  // never actually heard.
  const skipDeadVideo = () => {
    deadVideoStreakRef.current += 1;
    if (deadVideoStreakRef.current >= 5) {
      console.error('[player] 5 videos in a row failed to play — stopping so this cannot spin.');
      setRadioOn(false);
      return;
    }
    if (radioOnRef.current && atEndOfQueue()) appendRadioTrack(null);
    else nextTrack();
  };

  const handlePlayerVideoError = (badId, code) => {
    if (!badId) {
      skipDeadVideo();
      return;
    }
    // We may have downloaded this one already — play our copy rather than
    // losing the song. LocalVideoPlayer tells us if there is no file.
    console.warn(`[player] YouTube refused ${badId} (error ${code}) — trying the local file`);
    ytErrorCodeRef.current = code;
    setLocalFallbackId(badId);
  };

  // No local copy either — now the song is genuinely gone.
  const handleLocalUnavailable = (badId) => {
    const track = currentPlayerTrack;
    const code = ytErrorCodeRef.current;
    console.warn(`[player] no local file for ${badId} either — skipping`);
    setLocalFallbackId('');
    // Only purge it from the library if YouTube said it is permanently dead.
    // A transient playback error should not cost you the track.
    if (UNPLAYABLE_ERROR_CODES.has(code) && track?.artist && track?.title) {
      fetch(`${API_BASE}/yt-unplayable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: track.artist,
          title: track.title,
          videoId: badId,
          errorCode: code,
        }),
      }).catch(() => {});
    }
    skipDeadVideo();
  };

  const handleNext = () => {
    if (!radioOnRef.current || !atEndOfQueue()) {
      nextTrack();
      return;
    }
    deadVideoStreakRef.current = 0;
    reportRadio('skip', currentPlayerTrack, playerState.currentTime);
    appendRadioTrack(null);
  };

  const nextTrack = () => {
    const q = playerQueueRef.current;
    setPlayerIndex((i) => {
      if (q.length <= 1) return i;
      return (i + 1) % q.length;
    });
  };

  const prevTrack = () => {
    const q = playerQueueRef.current;
    setPlayerIndex((i) => {
      if (q.length <= 1) return i;
      return (i - 1 + q.length) % q.length;
    });
  };

  const displayMedia = isPlayer && currentPlayerTrack
    ? {
      artist: currentPlayerTrack.artist || '',
      title: currentPlayerTrack.title || currentPlayerTrack.videoTitle || '',
      album: currentPlayerTrack.album || '',
      albumArt: null,
      artistImages: [],
      dominantColors: [],
      genres: [],
      detectionSource: 'player',
      youtubeVideoId: currentPlayerTrack.videoId || '',
    }
    : media;

  return (
    <div className={`app${mode === 'video' ? ' video-mode' : ''}`}>
      <div className="header">
        <div className="app-mode-toggle">
          <button
            className={appMode === 'live' ? 'active' : ''}
            onClick={() => { setAppMode('live'); refreshMedia(); }}
          >
            Live
          </button>
          <button
            className={appMode === 'player' ? 'active' : ''}
            onClick={switchToPlayer}
          >
            Player
          </button>
        </div>
        <ModeSelector mode={mode} setMode={setMode} />
        {!connected && (
          <div className="status disconnected">Connecting...</div>
        )}
        <button
          className={`debug-toggle${radioOn ? ' active' : ''}`}
          onClick={toggleRadio}
          title="Play a random song, then keep picking songs that drift in and out of the same genre"
        >
          Rando
        </button>
        <button className="debug-toggle" onClick={() => setShowHistory(h => !h)}>
          {showHistory ? 'Hide' : 'Show'} History
        </button>
        <button className="debug-toggle" onClick={() => setShowPlaylist(p => !p)}>
          {showPlaylist ? 'Hide' : 'Show'} Playlists
        </button>
        <button className="debug-toggle" onClick={() => setShowMisses(m => !m)}>
          {showMisses ? 'Hide' : 'Show'} YT Misses
        </button>
        {appMode === 'live' && (
          <button
            className={`debug-toggle${forceSynthetic ? ' active' : ''}`}
            onClick={() => setForceSynthetic(s => !s)}
            title="Switch between the artist's YouTube video and an AI-generated music video"
          >
            {forceSynthetic ? 'Real Video' : 'AI Video'}
          </button>
        )}
      </div>

      <YouTubeBackground
        appMode={appMode}
        videoId={media?.youtubeVideoId}
        playerTrack={currentPlayerTrack}
        nextPlayerTrack={nextPlayerTrack}
        onTrackEnded={handleTrackEnded}
        onPlayerState={(st) => { if (!localFallbackId) setPlayerState(st); }}
        onPlayerVideoError={handlePlayerVideoError}
        onLiveVideoError={(badId, code) => {
          if (!media?.artist || !media?.title) return;
          fetch(`${API_BASE}/yt-unplayable`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              artist: media.artist,
              title: media.title,
              videoId: badId,
              errorCode: code,
            }),
          }).catch(() => {});
        }}
        controlsRef={playerControlsRef}
      />

      <LocalVideoPlayer
        videoId={isPlayer ? localFallbackId : ''}
        volume={playerState.volume}
        controlsRef={localControlsRef}
        onState={setPlayerState}
        onEnded={handleTrackEnded}
        onUnavailable={handleLocalUnavailable}
      />

      {showLocalVideo && (
        <LocalVideoFx media={media} />
      )}

      {showSynthetic && (
        <SyntheticVideo dataRef={dataRef} media={media} />
      )}

      {showFallback && (
        <div className="synthetic-banner" role="status">
          <span className="synthetic-banner-dot">◌</span>
          <span className="synthetic-banner-text">
            <strong>
              {showLocalVideo
                ? 'MTV Mode'
                : forceSynthetic && hasRealVideo ? 'AI Video Mode' : 'Image-Only Mode'}
            </strong>
            <span className="synthetic-banner-sub">
              {showLocalVideo
                ? 'Embed unavailable — playing the saved video with FX.'
                : forceSynthetic && hasRealVideo
                  ? 'Generated music video — composed from album art & artist images.'
                  : 'No YouTube video for this track — visuals composed from album art & artist images.'}
            </span>
          </span>
        </div>
      )}

      {is3D ? (
        <ThreeVisualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      ) : (
        <Visualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      )}

      <TrackInfo media={displayMedia} hasVideo={Boolean(displayMedia?.youtubeVideoId || (isPlayer && currentPlayerTrack?.videoId))} />
      <SongHistory historyVersion={historyVersion} visible={showHistory} onPlayFromHistory={playFromHistory} activeVideoId={isPlayer ? currentPlayerTrack?.videoId : null} media={media} />
      <PlaylistPanel visible={showPlaylist && appMode === 'live'} currentMedia={media} />
      <LibraryPanel
        visible={showPlaylist && appMode === 'player'}
        onPlayTrack={playTrack}
        onPlayFromLibrary={playFromHistory}
        onQueuePlaylist={queuePlaylist}
      />
      <YtMissesPanel visible={showMisses} />
      <PlayerControls
        visible={isPlayer}
        currentTrack={currentPlayerTrack}
        nextTrack={nextPlayerTrack}
        queuePosition={playerIndex}
        queueLength={playerQueue.length}
        isPlaying={playerState.playing}
        currentTime={playerState.currentTime}
        duration={playerState.duration}
        volume={playerState.volume}
        onPlayPause={() => {
          const controls = activeControls();
          if (!controls) return;
          const state = controls.getState?.();
          if (state?.playing) controls.pause?.();
          else controls.play?.();
        }}
        onPrev={prevTrack}
        onNext={handleNext}
        onSeek={(t) => activeControls()?.seek?.(t)}
        onVolume={(v) => activeControls()?.setVolume?.(v)}
      />
    </div>
  );
}
