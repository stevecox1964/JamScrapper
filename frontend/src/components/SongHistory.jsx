import { useState, useEffect, useRef } from 'react';

export default function SongHistory({ historyVersion, visible }) {
  const [history, setHistory] = useState([]);
  const lastVersion = useRef(0);

  // Fetch on mount
  useEffect(() => {
    fetch('http://localhost:8766/history')
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  }, []);

  // Refetch when history version bumps
  useEffect(() => {
    if (historyVersion !== lastVersion.current) {
      lastVersion.current = historyVersion;
      fetch('http://localhost:8766/history')
        .then((r) => r.json())
        .then(setHistory)
        .catch(() => {});
    }
  }, [historyVersion]);

  if (!visible) return null;

  return (
    <div className="history-panel">
      <div className="history-title">Play History</div>
      <div className="history-list">
        {history.map((entry, i) => (
          <div key={i} className="history-entry">
            <span className="history-time">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="history-track">
              {entry.artist} &mdash; {entry.title}
            </span>
            <span className="history-source">{entry.source}</span>
          </div>
        ))}
        {history.length === 0 && (
          <div className="history-empty">No songs played yet</div>
        )}
      </div>
    </div>
  );
}
