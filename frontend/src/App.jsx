import { useState, useRef, useEffect } from 'react';
import useAudioWebSocket from './hooks/useAudioWebSocket';
import Visualizer from './components/Visualizer';
import ThreeVisualizer from './components/ThreeVisualizer';
import ModeSelector from './components/ModeSelector';
import TrackInfo from './components/TrackInfo';
import SongHistory from './components/SongHistory';
import PlaylistPanel from './components/PlaylistPanel';
import YouTubeBackground from './components/YouTubeBackground';
import MediaTextureManager from './utils/mediaTextureManager';
import './App.css';

const THREE_D_MODES = new Set(['tunnel', 'galaxy', 'terrain', 'starfield']);

export default function App() {
  const [mode, setMode] = useState('video');
  const [showHistory, setShowHistory] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const { dataRef, connected, media, historyVersion } = useAudioWebSocket('ws://localhost:8765');
  const mediaManagerRef = useRef(new MediaTextureManager());

  useEffect(() => {
    if (media) mediaManagerRef.current.update(media);
  }, [media]);

  useEffect(() => {
    return () => mediaManagerRef.current.dispose();
  }, []);

  const is3D = THREE_D_MODES.has(mode);

  return (
    <div className={`app${mode === 'video' ? ' video-mode' : ''}`}>
      <div className="header">
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

      <YouTubeBackground videoId={media?.youtubeVideoId} downloadStatus={media?.videoDownloadStatus} />

      {is3D ? (
        <ThreeVisualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      ) : (
        <Visualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      )}

      <TrackInfo media={media} />
      <SongHistory historyVersion={historyVersion} visible={showHistory} />
      <PlaylistPanel visible={showPlaylist} currentMedia={media} />
    </div>
  );
}
