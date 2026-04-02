import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../config';

export default function SongHistory({ historyVersion, visible, onPlayFromHistory, activeVideoId }) {
  const [history, setHistory] = useState([]);
  const [info, setInfo] = useState('');
  const lastVersion = useRef(0);

  // Fetch on mount
  useEffect(() => {
    fetch(`${API_BASE}/history/playable`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  }, []);

  // Refetch when history version bumps
  useEffect(() => {
    if (historyVersion !== lastVersion.current) {
      lastVersion.current = historyVersion;
      fetch(`${API_BASE}/history/playable`)
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
            className={`history-entry history-entry-btn${entry.isPlayable ? ' playable' : ''}${activeVideoId && entry.videoId === activeVideoId ? ' now-playing' : ''}`}
            onClick={() => {
              if (!entry.isPlayable) {
                setInfo('No YouTube video found for this track.');
                window.setTimeout(() => setInfo(''), 2000);
                return;
              }
              const playable = history.filter(e => e.isPlayable).map(e => ({
                videoId: e.videoId,
                artist: e.artist,
                title: e.title,
                videoTitle: e.videoTitle || e.title || '',
                duration: e.duration || 0,
              }));
              const clickedPlayableIndex = history
                .filter(e => e.isPlayable)
                .findIndex(e => e === entry);
              onPlayFromHistory?.(playable, Math.max(0, clickedPlayableIndex));
            }}
            title={entry.isPlayable ? 'Play on YouTube' : 'No video found'}
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
