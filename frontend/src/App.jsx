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
  const { dataRef, connected, media } = useAudioWebSocket('ws://localhost:8765');

  const is3D = THREE_D_MODES.has(mode);

  return (
    <div className="app">
      <div className="header">
        <ModeSelector mode={mode} setMode={setMode} />
        <div className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Connecting...'}
        </div>
      </div>
      {is3D ? (
        <ThreeVisualizer mode={mode} dataRef={dataRef} />
      ) : (
        <Visualizer mode={mode} dataRef={dataRef} />
      )}
      <TrackInfo media={media} />
    </div>
  );
}
