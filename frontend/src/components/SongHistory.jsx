import { useState, useEffect, useRef } from 'react';
import { API_BASE, thumbnailUrl } from '../config';

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function resolveUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
}

function HistoryEntryContent({ entry, isNowPlaying }) {
  const thumbSrc = entry.videoId
    ? thumbnailUrl(entry.videoId)
    : resolveUrl(entry.thumbnail_url);
  const artistImg = Array.isArray(entry.artist_images) && entry.artist_images.length > 0
    ? resolveUrl(entry.artist_images[0])
    : '';
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const duration = formatDuration(entry.duration);

  return (
    <>
      <div className="history-thumb-wrap">
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="history-thumb" loading="lazy" />
        ) : (
          <div className="history-thumb history-thumb-placeholder" />
        )}
        {artistImg && (
          <img src={artistImg} alt="" className="history-artist-img" loading="lazy" />
        )}
      </div>
      <div className="history-body">
        <div className="history-row-top">
          <span className="history-time">{time}</span>
          {isNowPlaying && <span className="history-now-badge">NOW PLAYING</span>}
          <span className="history-source">{entry.source}</span>
          {duration && <span className="history-duration">{duration}</span>}
        </div>
        <div className="history-artist">{entry.artist || 'Unknown artist'}</div>
        <div className="history-title-line">{entry.title || 'Unknown title'}</div>
        {entry.album && <div className="history-album">{entry.album}</div>}
        {entry.genres && entry.genres.length > 0 && (
          <div className="history-genres">
            {entry.genres.slice(0, 6).map((g, j) => (
              <span key={j} className="history-genre-tag">{g}</span>
            ))}
          </div>
        )}
        {entry.dominant_colors && entry.dominant_colors.length > 0 && (
          <div className="history-colors">
            {entry.dominant_colors.slice(0, 6).map((c, j) => (
              <span
                key={j}
                className="history-color-dot"
                style={{ backgroundColor: `rgb(${c[0]},${c[1]},${c[2]})` }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function SongHistory({ historyVersion, visible, onPlayFromHistory, activeVideoId, media }) {
  const [history, setHistory] = useState([]);
  const [info, setInfo] = useState('');
  const lastVersion = useRef(0);

  const fetchHistory = () => {
    return fetch(`${API_BASE}/history/playable`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        console.log('[SongHistory] Fetched', arr.length, 'entries');
        setHistory(arr);
        return arr;
      })
      .catch((err) => {
        console.error('[SongHistory] Fetch failed:', err, 'URL:', `${API_BASE}/history/playable`);
        return null;
      });
  };

  // Startup retry loop: retry until we get a non-empty response or give up after ~15s.
  // Handles the race where frontend mounts before backend is ready.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 15;
    const tryFetch = async () => {
      if (cancelled) return;
      attempts++;
      const result = await fetchHistory();
      // Keep retrying on failure OR empty result until we get data or hit cap
      if (!cancelled && attempts < maxAttempts && (!result || result.length === 0)) {
        setTimeout(tryFetch, 1000);
      }
    };
    tryFetch();
    return () => { cancelled = true; };
  }, []);

  // Fetch when a new track is detected
  useEffect(() => {
    if (historyVersion !== lastVersion.current) {
      lastVersion.current = historyVersion;
      fetchHistory();
    }
  }, [historyVersion]);

  // Extra safety: fetch whenever the live media changes.
  // This covers startup races where historyVersion can be stale.
  useEffect(() => {
    if (!media?.artist && !media?.title && !media?.youtubeVideoId) return;
    fetchHistory();
  }, [media?.artist, media?.title, media?.youtubeVideoId]);

  // Fetch immediately when panel becomes visible + poll for enrichment backfills
  useEffect(() => {
    if (!visible) return;
    fetchHistory();
    const id = setInterval(fetchHistory, 3000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const handleClick = (entry) => {
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
  };

  return (
    <div className="history-panel">
      <div className="history-title">Play History</div>
      {info && <div className="history-info">{info}</div>}
      <div className="history-list">
        {history.map((entry, i) => {
          const isNowPlaying = i === 0 || (activeVideoId && entry.videoId === activeVideoId);
          const classes = [
            'history-card',
            entry.isPlayable ? 'playable' : '',
            isNowPlaying ? 'now-playing' : '',
            i === 0 ? 'hero' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={i}
              type="button"
              className={classes}
              onClick={() => handleClick(entry)}
              title={entry.isPlayable ? 'Play on YouTube' : 'No video found'}
            >
              <HistoryEntryContent entry={entry} isNowPlaying={isNowPlaying} />
            </button>
          );
        })}
        {history.length === 0 && (
          <div className="history-empty">No songs played yet</div>
        )}
      </div>
    </div>
  );
}
