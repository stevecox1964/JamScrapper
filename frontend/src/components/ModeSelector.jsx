const modes = [
  { id: 'video', label: 'Video' },
  { id: 'starfield', label: 'Starfield' },
];

export default function ModeSelector({ mode, setMode }) {
  return (
    <div className="mode-selector">
      {modes.map((m) => (
        <button
          key={m.id}
          className={mode === m.id ? 'active' : ''}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
