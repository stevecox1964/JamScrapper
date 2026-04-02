import { useState, useEffect, useCallback } from 'react';
import { API_BASE as API } from '../config';

export default function PlaylistPanel({ visible, currentMedia }) {
  const [playlists, setPlaylists] = useState([]);
  const [expanded, setExpanded] = useState(null); // playlist id
  const [expandedData, setExpandedData] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const fetchPlaylists = useCallback(() => {
    fetch(`${API}/playlists`).then(r => r.json()).then(setPlaylists).catch(() => {});
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchPlaylists();
  }, [visible, fetchPlaylists]);

  const expandPlaylist = (id) => {
    if (expanded === id) {
      setExpanded(null);
      setExpandedData(null);
      return;
    }
    setExpanded(id);
    fetch(`${API}/playlists/${id}`).then(r => r.json()).then(setExpandedData).catch(() => {});
  };

  const createPlaylist = () => {
    if (!newName.trim()) return;
    fetch(`${API}/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: newName.trim() }),
    })
      .then(r => r.json())
      .then(() => {
        setNewName('');
        setCreating(false);
        fetchPlaylists();
      })
      .catch(() => {});
  };

  const addCurrentTrack = (playlistId) => {
    if (!currentMedia?.youtubeVideoId) return;
    fetch(`${API}/playlists/${playlistId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_track',
        videoId: currentMedia.youtubeVideoId,
        artist: currentMedia.artist || '',
        title: currentMedia.title || '',
        videoTitle: currentMedia.youtubeTitle || '',
        duration: currentMedia.youtubeDuration || 0,
      }),
    })
      .then(r => r.json())
      .then((pl) => {
        if (expanded === playlistId) setExpandedData(pl);
        fetchPlaylists();
      })
      .catch(() => {});
  };

  const removeTrack = (playlistId, videoId) => {
    fetch(`${API}/playlists/${playlistId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_track', videoId }),
    })
      .then(r => r.json())
      .then((pl) => {
        setExpandedData(pl);
        fetchPlaylists();
      })
      .catch(() => {});
  };

  const deletePlaylist = (playlistId) => {
    fetch(`${API}/playlists/${playlistId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    })
      .then(() => {
        if (expanded === playlistId) {
          setExpanded(null);
          setExpandedData(null);
        }
        fetchPlaylists();
      })
      .catch(() => {});
  };

  const canAdd = Boolean(currentMedia?.youtubeVideoId);

  if (!visible) return null;

  return (
    <div className="playlist-panel">
      <div className="playlist-header">
        <div className="playlist-title">Playlists</div>
        <button className="playlist-add-btn" onClick={() => setCreating(c => !c)}>+</button>
      </div>

      {creating && (
        <div className="playlist-create">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createPlaylist()}
            placeholder="Playlist name..."
            className="playlist-input"
            autoFocus
          />
          <button className="playlist-create-btn" onClick={createPlaylist}>Create</button>
        </div>
      )}

      <div className="playlist-list">
        {playlists.map(pl => (
          <div key={pl.id} className="playlist-item">
            <div className="playlist-row" onClick={() => expandPlaylist(pl.id)}>
              <span className="playlist-arrow">{expanded === pl.id ? '\u25BC' : '\u25B6'}</span>
              <span className="playlist-name">{pl.name}</span>
              <span className="playlist-count">{pl.trackCount} tracks</span>
              {canAdd && (
                <button
                  className="playlist-add-track"
                  onClick={e => { e.stopPropagation(); addCurrentTrack(pl.id); }}
                  title="Add current track"
                >
                  +
                </button>
              )}
              <button
                className="playlist-delete"
                onClick={e => { e.stopPropagation(); deletePlaylist(pl.id); }}
                title="Delete playlist"
              >
                ×
              </button>
            </div>
            {expanded === pl.id && expandedData && (
              <div className="playlist-tracks">
                {expandedData.tracks?.map((t, i) => (
                  <div key={t.videoId} className="playlist-track">
                    <span className="playlist-track-num">{i + 1}.</span>
                    <span className="playlist-track-info">
                      {t.title} - {t.artist}
                    </span>
                    <button
                      className="playlist-track-remove"
                      onClick={() => removeTrack(pl.id, t.videoId)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {(!expandedData.tracks || expandedData.tracks.length === 0) && (
                  <div className="playlist-empty">No tracks yet</div>
                )}
              </div>
            )}
          </div>
        ))}
        {playlists.length === 0 && !creating && (
          <div className="playlist-empty">No playlists yet. Click + to create one.</div>
        )}
      </div>

    </div>
  );
}
