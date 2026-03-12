import { useState, useEffect, useRef } from 'react';

export default function SongHistory({ historyVersion, visible, onPlayTrack }) {
  const [history, setHistory] = useState([]);
  const [info, setInfo] = useState('');
  const lastVersion = useRef(0);

  // Fetch on mount
  useEffect(() => {
    fetch('http://localhost:8766/history/playable')
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  }, []);

  // Refetch when history version bumps
  useEffect(() => {
    if (historyVersion !== lastVersion.current) {
      lastVersion.current = historyVersion;
      fetch('http://localhost:8766/history/playable')
        .then((r) => r.json())
        .then(setHistory)
        .catch(() => {});
    }
  }, [historyVersion]);

  if (!visible) return null;

  return (
    <div className="history-panel">
      <div className="history-title">Play History</div>
      {info && <div className="history-info">{info}</div>}
      <div className="history-list">
        {history.map((entry, i) => (
          <button
            key={i}
            className={`history-entry history-entry-btn${entry.isPlayable ? ' playable' : ''}`}
            onClick={() => {
              if (!entry.isPlayable) {
                setInfo('This song is in history but not downloaded yet.');
                window.setTimeout(() => setInfo(''), 2000);
                return;
              }
              onPlayTrack?.({
                videoId: entry.videoId,
                artist: entry.artist,
                title: entry.title,
                videoTitle: entry.videoTitle || entry.title || '',
                duration: entry.duration || 0,
                fileSizeMB: entry.fileSizeMB || 0,
              });
            }}
            title={entry.isPlayable ? 'Play saved video' : 'Not saved yet'}
          >
            <span className="history-time">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="history-track">
              {entry.artist} &mdash; {entry.title}
            </span>
            <span className="history-source">{entry.source}</span>
          </button>
        ))}
        {history.length === 0 && (
          <div className="history-empty">No songs played yet</div>
        )}
      </div>
    </div>
  );
}
