import { useEffect, useState } from 'react';
import { API_BASE as API } from '../config';

export default function LibraryPanel({ visible, onPlayTrack, onPlayFromLibrary, onQueuePlaylist }) {
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [expandedId, setExpandedId] = useState('');
  const [expandedPlaylist, setExpandedPlaylist] = useState(null);

  useEffect(() => {
    if (!visible) return;
    fetch(`${API}/library`)
      .then(r => r.json())
      .then(data => setTracks(data.tracks || []))
      .catch(() => {});
    fetch(`${API}/playlists`)
      .then(r => r.json())
      .then(setPlaylists)
      .catch(() => {});
  }, [visible]);

  const togglePlaylist = async (id) => {
    if (expandedId === id) {
      setExpandedId('');
      setExpandedPlaylist(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await fetch(`${API}/playlists/${id}`);
      const pl = await res.json();
      setExpandedPlaylist(pl);
    } catch (_) {
      setExpandedPlaylist(null);
    }
  };

  if (!visible) return null;

  return (
    <div className="library-panel">
      <div className="library-title">Player Library</div>

      <div className="library-section-title">Saved Tracks</div>
      <div className="library-list">
        {tracks.map((t) => (
          <button key={t.videoId} className="library-track" onClick={() => {
            if (onPlayFromLibrary) onPlayFromLibrary(tracks, tracks.indexOf(t));
            else onPlayTrack?.(t);
          }}>
            <span className="library-track-title">{t.title || t.videoTitle || t.videoId}</span>
            <span className="library-track-artist">{t.artist || ''}</span>
          </button>
        ))}
        {tracks.length === 0 && <div className="library-empty">No saved tracks yet.</div>}
      </div>

      <div className="library-section-title">Playlists</div>
      <div className="library-list">
        {playlists.map((pl) => (
          <div key={pl.id} className="library-playlist-item">
            <button className="library-playlist-row" onClick={() => togglePlaylist(pl.id)}>
              <span>{expandedId === pl.id ? '▼' : '▶'}</span>
              <span className="library-playlist-name">{pl.name}</span>
              <span className="library-playlist-count">{pl.trackCount}</span>
            </button>
            {expandedId === pl.id && expandedPlaylist && (
              <div className="library-playlist-tracks">
                <button
                  className="library-playlist-playall"
                  onClick={() => onQueuePlaylist?.(expandedPlaylist)}
                >
                  Play Playlist
                </button>
                {(expandedPlaylist.tracks || []).map((t, idx) => (
                  <button
                    key={t.videoId}
                    className="library-track"
                    onClick={() => {
                      if (onPlayFromLibrary) onPlayFromLibrary(expandedPlaylist.tracks, idx);
                      else onPlayTrack?.(t);
                    }}
                  >
                    <span className="library-track-title">{t.title || t.videoTitle || t.videoId}</span>
                    <span className="library-track-artist">{t.artist || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
