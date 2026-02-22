const modes2D = [
  { id: 'bars', label: 'Bars' },
  { id: 'waveform', label: 'Waveform' },
  { id: 'radial', label: 'Radial' },
];

const modes3D = [
  { id: 'tunnel', label: 'Tunnel' },
  { id: 'galaxy', label: 'Galaxy' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'starfield', label: 'Starfield' },
];

export default function ModeSelector({ mode, setMode }) {
  return (
    <div className="mode-selector">
      <span className="mode-group-label">2D</span>
      {modes2D.map((m) => (
        <button
          key={m.id}
          className={mode === m.id ? 'active' : ''}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
      <span className="mode-divider" />
      <span className="mode-group-label">3D</span>
      {modes3D.map((m) => (
        <button
          key={m.id}
          className={mode === m.id ? 'active three-d' : 'three-d'}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
