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
import YouTubeBackground from './components/YouTubeBackground';
import MediaTextureManager from './utils/mediaTextureManager';
import './App.css';

const THREE_D_MODES = new Set(['tunnel', 'galaxy', 'terrain', 'starfield']);

export default function App() {
  const [appMode, setAppMode] = useState('live');
  const [mode, setMode] = useState('video');
  const [showHistory, setShowHistory] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const { dataRef, connected, media, historyVersion } = useAudioWebSocket('ws://localhost:8765');
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

  useEffect(() => {
    if (media) mediaManagerRef.current.update(media);
  }, [media]);

  useEffect(() => {
    return () => mediaManagerRef.current.dispose();
  }, []);

  useEffect(() => {
    playerQueueRef.current = playerQueue;
  }, [playerQueue]);

  const is3D = THREE_D_MODES.has(mode);
  const currentPlayerTrack = playerQueue[playerIndex] || null;
  const nextPlayerTrack = playerQueue.length > 1
    ? playerQueue[(playerIndex + 1) % playerQueue.length]
    : null;
  const isPlayer = appMode === 'player';

  const playTrack = (track) => {
    if (!track?.videoId) return;
    setPlayerQueue([track]);
    setPlayerIndex(0);
    setAppMode('player');
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
      album: '',
      albumArt: null,
      artistImages: [],
      dominantColors: [],
      genres: [],
      detectionSource: 'player',
      videoDownloadStatus: { state: 'completed', fileSizeMB: currentPlayerTrack.fileSizeMB || 0 },
    }
    : media;

  return (
    <div className={`app${mode === 'video' ? ' video-mode' : ''}`}>
      <div className="header">
        <div className="app-mode-toggle">
          <button
            className={appMode === 'live' ? 'active' : ''}
            onClick={() => setAppMode('live')}
          >
            Live
          </button>
          <button
            className={appMode === 'player' ? 'active' : ''}
            onClick={() => setAppMode('player')}
          >
            Player
          </button>
        </div>
        <ModeSelector mode={mode} setMode={setMode} />
        <div className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Connecting...'}
        </div>
        <button className="debug-toggle" onClick={() => setShowHistory(h => !h)}>
          {showHistory ? 'Hide' : 'Show'} History
        </button>
        <button className="debug-toggle" onClick={() => setShowPlaylist(p => !p)}>
          {showPlaylist ? 'Hide' : 'Show'} Playlists
        </button>
      </div>

      <YouTubeBackground
        appMode={appMode}
        videoId={media?.youtubeVideoId}
        downloadStatus={media?.videoDownloadStatus}
        playerTrack={currentPlayerTrack}
        nextPlayerTrack={nextPlayerTrack}
        onTrackEnded={nextTrack}
        onPlayerState={setPlayerState}
        controlsRef={playerControlsRef}
      />

      {is3D ? (
        <ThreeVisualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      ) : (
        <Visualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      )}

      <TrackInfo media={displayMedia} hasVideo={Boolean(displayMedia?.youtubeVideoId || (isPlayer && currentPlayerTrack?.videoId))} />
      <SongHistory historyVersion={historyVersion} visible={showHistory} onPlayTrack={playTrack} />
      <PlaylistPanel visible={showPlaylist && appMode === 'live'} currentMedia={media} />
      <LibraryPanel
        visible={showPlaylist && appMode === 'player'}
        onPlayTrack={playTrack}
        onQueuePlaylist={queuePlaylist}
      />
      <PlayerControls
        visible={isPlayer}
        currentTrack={currentPlayerTrack}
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
