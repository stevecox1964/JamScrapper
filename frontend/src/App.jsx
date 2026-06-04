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
import YouTubeBackground from './components/YouTubeBackground';
import SyntheticVideo from './components/SyntheticVideo';
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
  const { dataRef, connected, media, historyVersion, refreshMedia } = useAudioWebSocket(WS_URL);
  const mediaManagerRef = useRef(new MediaTextureManager());
  const playerControlsRef = useRef(null);
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

  // Restore player state from backend on mount
  useEffect(() => {
    fetch(`${API_BASE}/player-state`)
      .then(r => r.json())
      .then(state => {
        if (state?.queue?.length) {
          setPlayerQueue(state.queue);
          setPlayerIndex(state.queueIndex || 0);
          setPlayerState(prev => ({ ...prev, volume: state.volume ?? 1 }));
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
  // Synthetic compositor runs when no real video was found, OR when the user
  // forces it on to compare the artist's video against the generated one.
  const hasRealVideo = Boolean(media?.youtubeVideoId);
  const showSynthetic = appMode === 'live' && (media?.youtubeSearchStatus === 'not_found' || forceSynthetic);

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
        onTrackEnded={nextTrack}
        onPlayerState={setPlayerState}
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

      {showSynthetic && (
        <SyntheticVideo dataRef={dataRef} media={media} />
      )}

      {showSynthetic && (
        <div className="synthetic-banner" role="status">
          <span className="synthetic-banner-dot">◌</span>
          <span className="synthetic-banner-text">
            <strong>{forceSynthetic && hasRealVideo ? 'AI Video Mode' : 'Image-Only Mode'}</strong>
            <span className="synthetic-banner-sub">
              {forceSynthetic && hasRealVideo
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
          const controls = playerControlsRef.current;
          if (!controls) return;
          const state = controls.getState?.();
          if (state?.playing) controls.pause?.();
          else controls.play?.();
        }}
        onPrev={prevTrack}
        onNext={nextTrack}
        onSeek={(t) => playerControlsRef.current?.seek?.(t)}
        onVolume={(v) => playerControlsRef.current?.setVolume?.(v)}
      />
    </div>
  );
}
