import { useState } from 'react';
import useAudioWebSocket from './hooks/useAudioWebSocket';
import Visualizer from './components/Visualizer';
import ThreeVisualizer from './components/ThreeVisualizer';
import ModeSelector from './components/ModeSelector';
import TrackInfo from './components/TrackInfo';
import './App.css';

const THREE_D_MODES = new Set(['tunnel', 'galaxy', 'terrain', 'starfield']);

export default function App() {
  const [mode, setMode] = useState('bars');
  const [showDebug, setShowDebug] = useState(true);
  const { dataRef, connected, media, rawMedia } = useAudioWebSocket('ws://localhost:8765');

  const is3D = THREE_D_MODES.has(mode);

  return (
    <div className="app">
      <div className="header">
        <ModeSelector mode={mode} setMode={setMode} />
        <div className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Connecting...'}
        </div>
        <button className="debug-toggle" onClick={() => setShowDebug(d => !d)}>
          {showDebug ? 'Hide' : 'Show'} Debug
        </button>
      </div>
      {is3D ? (
        <ThreeVisualizer mode={mode} dataRef={dataRef} />
      ) : (
        <Visualizer mode={mode} dataRef={dataRef} />
      )}
      <TrackInfo media={media} />
      {showDebug && (
        <div className="debug-panel">
          <div className="debug-title">Media Detection Debug</div>
          {!rawMedia ? (
            <div className="debug-row"><span className="debug-label">Status:</span> No media data from backend</div>
          ) : (
            <>
              <div className="debug-row"><span className="debug-label">Artist:</span> {rawMedia.artist || '(empty)'}</div>
              <div className="debug-row"><span className="debug-label">Title:</span> {rawMedia.title || '(empty)'}</div>
              <div className="debug-row"><span className="debug-label">Album:</span> {rawMedia.album || '(empty)'}</div>
              <div className="debug-row"><span className="debug-label">Source:</span> {rawMedia.detectionSource || '(none)'}</div>
              <div className="debug-row"><span className="debug-label">Genres:</span> {rawMedia.genres?.join(', ') || '(none)'}</div>
              <div className="debug-row"><span className="debug-label">Images:</span> {rawMedia.artistImages?.length || 0}</div>
              <div className="debug-row"><span className="debug-label">Colors:</span> {rawMedia.dominantColors?.length || 0}</div>
              <div className="debug-row"><span className="debug-label">Version:</span> {rawMedia._profileVersion || 0}</div>
              <div className="debug-row"><span className="debug-label">Album Art:</span> {rawMedia.albumArt ? 'Yes' : 'No'}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
