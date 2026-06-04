import { useEffect, useState, useCallback } from 'react';
import { API_BASE as API } from '../config';

function formatAge(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function YtMissesPanel({ visible }) {
  const [misses, setMisses] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API}/yt-misses`)
      .then(r => r.json())
      .then(data => setMisses(data.misses || []))
      .catch(() => setMisses([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!visible) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [visible, load]);

  const clearOne = async (m) => {
    await fetch(`${API}/yt-misses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', artist: m.artist, title: m.title }),
    }).catch(() => {});
    load();
  };

  const clearAll = async () => {
    if (!misses.length) return;
    if (!confirm(`Clear all ${misses.length} misses? They'll be re-searched next time those tracks play.`)) return;
    await fetch(`${API}/yt-misses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_all' }),
    }).catch(() => {});
    load();
  };

  if (!visible) return null;

  return (
    <div className="yt-misses-panel">
      <div className="yt-misses-header">
        <div className="yt-misses-title">YouTube Misses</div>
        <div className="yt-misses-actions">
          <button className="yt-misses-btn" onClick={load} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
          <button className="yt-misses-btn danger" onClick={clearAll} disabled={!misses.length}>
            Clear All
          </button>
        </div>
      </div>
      <div className="yt-misses-subtitle">
        Tracks that couldn't be found on YouTube. These trigger synthetic video mode.
      </div>
      <div className="yt-misses-list">
        {misses.map((m) => (
          <div key={`${m.artist}|${m.title}`} className={`yt-miss-row${m.expired ? ' expired' : ''}`}>
            <div className="yt-miss-info">
              <div className="yt-miss-track">
                <span className="yt-miss-title">{m.title || '(no title)'}</span>
                {m.artist && <span className="yt-miss-artist"> — {m.artist}</span>}
              </div>
              <div className="yt-miss-meta">
                <span>{formatAge(m.searchedAt)}</span>
                <span>·</span>
                <span>{m.attempts} {m.attempts === 1 ? 'attempt' : 'attempts'}</span>
                {m.expired && <><span>·</span><span className="yt-miss-expired">expired</span></>}
              </div>
            </div>
            <button
              className="yt-miss-clear"
              title="Clear this miss — next play will re-search"
              onClick={() => clearOne(m)}
            >
              ✕
            </button>
          </div>
        ))}
        {!misses.length && !loading && (
          <div className="yt-misses-empty">No misses recorded. Every played track found a video.</div>
        )}
      </div>
    </div>
  );
}
