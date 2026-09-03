import { useState, useRef, useEffect } from 'react';
import useAudioWebSocket from './hooks/useAudioWebSocket';
import Visualizer from './components/Visualizer';
import ThreeVisualizer from './components/ThreeVisualizer';
import ModeSelector from './components/ModeSelector';
import TrackInfo from './components/TrackInfo';
import SongHistory from './components/SongHistory';
import PlaylistPanel from './components/PlaylistPanel';
import PlayerControls from './components/PlayerControls';
import MoodDisplay from './components/MoodDisplay';
import LibraryPanel from './components/LibraryPanel';
import YtMissesPanel from './components/YtMissesPanel';
import YouTubeBackground, { UNPLAYABLE_ERROR_CODES } from './components/YouTubeBackground';
import SyntheticVideo from './components/SyntheticVideo';
import LocalVideoFx from './components/LocalVideoFx';
import LocalVideoPlayer from './components/LocalVideoPlayer';
import MediaTextureManager from './utils/mediaTextureManager';
import { WS_URL, API_BASE } from './config';
import './App.css';

const THREE_D_MODES = new Set(['tunnel', 'galaxy', 'terrain', 'starfield']);
// How much of the Rando history to keep in the queue. Prev walks back this far.
const QUEUE_LIMIT = 60;

export default function App() {
  const [appMode, setAppMode] = useState('live');
  const [mode, setMode] = useState('video');
  const [showHistory, setShowHistory] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showMisses, setShowMisses] = useState(false);
  const [forceSynthetic, setForceSynthetic] = useState(false);
  const [radioOn, setRadioOn] = useState(false);
  // videoId -> 1 | -1, for this session only. The backend keeps the real tally.
  const [votes, setVotes] = useState({});
  // Rando's drift, made visible. [{genre, weight}], strongest first.
  const [mood, setMood] = useState([]);
  const [wildcard, setWildcard] = useState(false);
  const radioOnRef = useRef(false);
  const radioBusyRef = useRef(false);
  // Stops a run of dead videos from spinning the player forever.
  const deadVideoStreakRef = useRef(0);
  const { dataRef, connected, media, historyVersion, refreshMedia } = useAudioWebSocket(WS_URL);
  const mediaManagerRef = useRef(new MediaTextureManager());
  const playerControlsRef = useRef(null);
  const localControlsRef = useRef(null);
  // Set when YouTube refuses to embed a track we have on disk — the local file
  // takes over playback and PlayerControls is pointed at it instead.
  const [localFallbackId, setLocalFallbackId] = useState('');
  const ytErrorCodeRef = useRef(0);
  const playerQueueRef = useRef([]);
  const playerIndexRef = useRef(0);
  // Every videoId heard this session. Rando's queue is a history log, so this
  // is what stops Next from walking back through songs already played.
  const playedIdsRef = useRef(new Set());

  const [playerQueue, setPlayerQueue] = useState([]);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [playerState, setPlayerState] = useState({
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
  });
  const playerStateRestoredRef = useRef(false);

  useEffect(() => {
    if (media) mediaManagerRef.current.update(media);
  }, [media]);

  useEffect(() => {
    return () => mediaManagerRef.current.dispose();
  }, []);

  useEffect(() => {
    playerQueueRef.current = playerQueue;
  }, [playerQueue]);

  useEffect(() => {
    playerIndexRef.current = playerIndex;
  }, [playerIndex]);

  useEffect(() => {
    radioOnRef.current = radioOn;
  }, [radioOn]);

  useEffect(() => {
    const id = playerQueue[playerIndex]?.videoId;
    if (id) playedIdsRef.current.add(id);
  }, [playerIndex, playerQueue]);

  // Every new track starts fresh on YouTube; the local file is only a rescue.
  useEffect(() => {
    setLocalFallbackId('');
    ytErrorCodeRef.current = 0;
  }, [playerIndex, playerQueue]);

  // Restore player state from backend on mount
  useEffect(() => {
    fetch(`${API_BASE}/player-state`)
      .then(r => r.json())
      .then(state => {
        if (state?.queue?.length) {
          // The saved queue is a log of what was already heard, not a playlist
          // waiting to play. Resuming at the saved index left dozens of played
          // songs sitting in front of you, so Next had to be pressed through all
          // of them. Start at the end and remember the lot.
          state.queue.forEach((t) => { if (t?.videoId) playedIdsRef.current.add(t.videoId); });
          setPlayerQueue(state.queue);
          setPlayerIndex(state.queue.length - 1);
          // Volume is deliberately NOT restored: playback always starts at full.
          playerStateRestoredRef.current = true;
        }
      })
      .catch(() => {});
  }, []);

  // Save player state to backend when queue/index/volume changes
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (!playerQueue.length) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`${API_BASE}/player-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queue: playerQueue,
          queueIndex: playerIndex,
          currentTime: playerState.currentTime,
          volume: playerState.volume,
          playing: playerState.playing,
        }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [playerQueue, playerIndex, playerState.currentTime, playerState.volume]);

  const is3D = THREE_D_MODES.has(mode);
  const currentPlayerTrack = playerQueue[playerIndex] || null;
  // What actually plays next: the first unheard song after this one. Never
  // wraps — Rando does not wrap either, it asks for a fresh pick instead, so
  // wrapping here showed the first song of the session as "Up next" while a
  // brand new song played.
  const nextPlayerTrack = (() => {
    for (let i = playerIndex + 1; i < playerQueue.length; i += 1) {
      const id = playerQueue[i]?.videoId;
      if (id && !playedIdsRef.current.has(id)) return playerQueue[i];
    }
    return null;
  })();
  const isPlayer = appMode === 'player';
  // Fallback visuals when the embedded video can't show (or the user forces
  // them on). Priority: saved local video + MTV FX > image slideshow.
  const hasRealVideo = Boolean(media?.youtubeVideoId);
  const hasLocalVideo = Boolean(media?.localVideoUrl);
  const showFallback = appMode === 'live' && (media?.youtubeSearchStatus === 'not_found' || forceSynthetic);
  const showLocalVideo = showFallback && hasLocalVideo;
  const showSynthetic = showFallback && !hasLocalVideo;

  const activeControls = () => (
    localFallbackId ? localControlsRef.current : playerControlsRef.current
  );

  // There is only one playing mode now, and it is Rando. Anything you queue by
  // hand plays first; when it runs out Rando keeps the music going.
  const playTrack = (track) => {
    if (!track?.videoId) return;
    playedIdsRef.current = new Set();
    setPlayerQueue([track]);
    setPlayerIndex(0);
    setRadioOn(true);
    setAppMode('player');
  };

  const playFromHistory = (tracks, startIndex = 0) => {
    if (!tracks.length) return;
    playedIdsRef.current = new Set();
    setPlayerQueue(tracks);
    setPlayerIndex(startIndex);
    setRadioOn(true);
    setAppMode('player');
  };

  const queuePlaylist = (playlist) => {
    const tracks = (playlist?.tracks || []).filter(t => t.videoId);
    if (!tracks.length) return;
    playedIdsRef.current = new Set();
    setPlayerQueue(tracks);
    setPlayerIndex(0);
    setRadioOn(true);
    setAppMode('player');
  };

  // Radio: ask the backend for a genre-drifted random pick, append it, play it.
  const appendRadioTrack = async (seed) => {
    if (radioBusyRef.current) return false;
    radioBusyRef.current = true;
    try {
      const params = new URLSearchParams();
      if (seed?.artist) params.set('artist', seed.artist);
      if (seed?.title) params.set('title', seed.title);
      const res = await fetch(`${API_BASE}/radio/next?${params.toString()}`);
      const data = await res.json();
      const track = data?.track;
      if (!track?.videoId) {
        console.warn('[radio] no track returned:', data?.error || 'unknown reason');
        return false;
      }
      setMood(track.mood || []);
      setWildcard(Boolean(track.wildcard));
      // Drop the oldest entries once the log gets long. Prev still reaches back
      // a full session, and the saved state stops growing without limit.
      const queue = playerQueueRef.current;
      const kept = queue.length >= QUEUE_LIMIT ? queue.slice(-(QUEUE_LIMIT - 1)) : queue;
      setPlayerQueue([...kept, track]);
      setPlayerIndex(kept.length);
      return true;
    } catch (e) {
      console.warn('[radio] request failed:', e);
      return false;
    } finally {
      radioBusyRef.current = false;
    }
  };

  // The one way into playing mode. An existing queue is resumed; otherwise we
  // ask Rando for a first pick seeded by whatever is playing live right now.
  const enterRando = async () => {
    setRadioOn(true);
    if (playerQueueRef.current.length > 0) {
      setAppMode('player');
      return;
    }
    const seed = media?.artist ? { artist: media.artist, title: media.title } : null;
    const ok = await appendRadioTrack(seed);
    if (ok) setAppMode('player');
    else setRadioOn(false);
  };

  // The first song AFTER the current one that has not been heard yet, or -1.
  // Deliberately does not wrap: wrapping is what sent the player back to the
  // top of the queue and replayed the whole session.
  const nextUnplayedIndex = () => {
    const q = playerQueueRef.current;
    for (let i = playerIndexRef.current + 1; i < q.length; i += 1) {
      const id = q[i]?.videoId;
      if (id && !playedIdsRef.current.has(id)) return i;
    }
    return -1;
  };

  // The only way Rando moves forward. Play the next unheard song in the queue;
  // when there is nothing left to hear, ask Rando for a new one.
  const goForward = () => {
    if (!radioOnRef.current) {
      nextTrack();
      return;
    }
    const next = nextUnplayedIndex();
    if (next >= 0) setPlayerIndex(next);
    else appendRadioTrack(null);
  };

  const reportRadio = (path, track, playedSeconds) => {
    if (!track?.videoId) return;
    fetch(`${API_BASE}/radio/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: track.artist || '',
        title: track.title || '',
        videoId: track.videoId,
        playedSeconds: playedSeconds || 0,
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.mood) setMood(d.mood); })
      .catch(() => {});
  };

  const handleTrackEnded = () => {
    deadVideoStreakRef.current = 0;
    if (radioOnRef.current) {
      reportRadio('finished', currentPlayerTrack, playerState.duration);
    }
    goForward();
  };

  // A video that refuses to play is not a song you disliked. Move on WITHOUT
  // reporting a skip — recording one would teach Rando to avoid a track you
  // never actually heard.
  const skipDeadVideo = () => {
    deadVideoStreakRef.current += 1;
    if (deadVideoStreakRef.current >= 5) {
      console.error('[player] 5 videos in a row failed to play — stopping so this cannot spin.');
      setRadioOn(false);
      return;
    }
    goForward();
  };

  const handlePlayerVideoError = (badId, code) => {
    if (!badId) {
      skipDeadVideo();
      return;
    }
    // We may have downloaded this one already — play our copy rather than
    // losing the song. LocalVideoPlayer tells us if there is no file.
    console.warn(`[player] YouTube refused ${badId} (error ${code}) — trying the local file`);
    ytErrorCodeRef.current = code;
    setLocalFallbackId(badId);
  };

  // No local copy either — now the song is genuinely gone.
  const handleLocalUnavailable = (badId) => {
    const track = currentPlayerTrack;
    const code = ytErrorCodeRef.current;
    console.warn(`[player] no local file for ${badId} either — skipping`);
    setLocalFallbackId('');
    // Only purge it from the library if YouTube said it is permanently dead.
    // A transient playback error should not cost you the track.
    if (UNPLAYABLE_ERROR_CODES.has(code) && track?.artist && track?.title) {
      fetch(`${API_BASE}/yt-unplayable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: track.artist,
          title: track.title,
          videoId: badId,
          errorCode: code,
        }),
      }).catch(() => {});
    }
    skipDeadVideo();
  };

  // Move on without telling Rando anything. Used when the reason for moving is
  // already recorded (a thumbs down) or is not about the song (a dead video).
  const advance = () => {
    deadVideoStreakRef.current = 0;
    goForward();
  };

  const handleVote = (direction) => {
    const track = currentPlayerTrack;
    if (!track?.videoId || !direction) return;
    setVotes((v) => ({ ...v, [track.videoId]: direction }));
    fetch(`${API_BASE}/radio/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: track.artist || '',
        title: track.title || '',
        videoId: track.videoId,
        vote: direction,
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.mood) setMood(d.mood); })
      .catch(() => {});
    // Thumbs down means "not this one" — the vote is the signal, so move on
    // without also filing a skip and punishing the song twice.
    if (direction < 0) advance();
  };

  const handleNext = () => {
    deadVideoStreakRef.current = 0;
    if (radioOnRef.current) {
      reportRadio('skip', currentPlayerTrack, playerState.currentTime);
    }
    goForward();
  };

  const nextTrack = () => {
    const q = playerQueueRef.current;
    setPlayerIndex((i) => {
      if (q.length <= 1) return i;
      return (i + 1) % q.length;
    });
  };

  const prevTrack = () => {
    const q = playerQueueRef.current;
    setPlayerIndex((i) => {
      if (q.length <= 1) return i;
      return (i - 1 + q.length) % q.length;
    });
  };

  const displayMedia = isPlayer && currentPlayerTrack
    ? {
      artist: currentPlayerTrack.artist || '',
      title: currentPlayerTrack.title || currentPlayerTrack.videoTitle || '',
      album: currentPlayerTrack.album || '',
      albumArt: null,
      artistImages: [],
      dominantColors: [],
      genres: [],
      detectionSource: 'player',
      youtubeVideoId: currentPlayerTrack.videoId || '',
    }
    : media;

  return (
    <div className={`app${mode === 'video' ? ' video-mode' : ''}`}>
      <div className="header">
        <div className="app-mode-toggle">
          <button
            className={appMode === 'live' ? 'active' : ''}
            onClick={() => { setAppMode('live'); refreshMedia(); }}
          >
            Live
          </button>
          <button
            className={isPlayer ? 'active' : ''}
            onClick={enterRando}
            title="Play a random song, then keep picking songs that drift in and out of the same genre"
          >
            Rando
          </button>
        </div>
        <ModeSelector mode={mode} setMode={setMode} />
        {!connected && (
          <div className="status disconnected">Connecting...</div>
        )}
        <button className="debug-toggle" onClick={() => setShowHistory(h => !h)}>
          {showHistory ? 'Hide' : 'Show'} History
        </button>
        <button className="debug-toggle" onClick={() => setShowPlaylist(p => !p)}>
          {showPlaylist ? 'Hide' : 'Show'} Playlists
        </button>
        <button className="debug-toggle" onClick={() => setShowMisses(m => !m)}>
          {showMisses ? 'Hide' : 'Show'} YT Misses
        </button>
        {appMode === 'live' && (
          <button
            className={`debug-toggle${forceSynthetic ? ' active' : ''}`}
            onClick={() => setForceSynthetic(s => !s)}
            title="Switch between the artist's YouTube video and an AI-generated music video"
          >
            {forceSynthetic ? 'Real Video' : 'AI Video'}
          </button>
        )}
      </div>

      <YouTubeBackground
        appMode={appMode}
        videoId={media?.youtubeVideoId}
        playerTrack={currentPlayerTrack}
        nextPlayerTrack={nextPlayerTrack}
        onTrackEnded={handleTrackEnded}
        onPlayerState={(st) => { if (!localFallbackId) setPlayerState(st); }}
        onPlayerVideoError={handlePlayerVideoError}
        onLiveVideoError={(badId, code) => {
          if (!media?.artist || !media?.title) return;
          fetch(`${API_BASE}/yt-unplayable`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              artist: media.artist,
              title: media.title,
              videoId: badId,
              errorCode: code,
            }),
          }).catch(() => {});
        }}
        controlsRef={playerControlsRef}
      />

      <LocalVideoPlayer
        videoId={isPlayer ? localFallbackId : ''}
        volume={playerState.volume}
        controlsRef={localControlsRef}
        onState={setPlayerState}
        onEnded={handleTrackEnded}
        onUnavailable={handleLocalUnavailable}
      />

      {showLocalVideo && (
        <LocalVideoFx media={media} />
      )}

      {showSynthetic && (
        <SyntheticVideo dataRef={dataRef} media={media} />
      )}

      {showFallback && (
        <div className="synthetic-banner" role="status">
          <span className="synthetic-banner-dot">◌</span>
          <span className="synthetic-banner-text">
            <strong>
              {showLocalVideo
                ? 'MTV Mode'
                : forceSynthetic && hasRealVideo ? 'AI Video Mode' : 'Image-Only Mode'}
            </strong>
            <span className="synthetic-banner-sub">
              {showLocalVideo
                ? 'Embed unavailable — playing the saved video with FX.'
                : forceSynthetic && hasRealVideo
                  ? 'Generated music video — composed from album art & artist images.'
                  : 'No YouTube video for this track — visuals composed from album art & artist images.'}
            </span>
          </span>
        </div>
      )}

      {is3D ? (
        <ThreeVisualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      ) : (
        <Visualizer mode={mode} dataRef={dataRef} mediaManager={mediaManagerRef} />
      )}

      <TrackInfo media={displayMedia} hasVideo={Boolean(displayMedia?.youtubeVideoId || (isPlayer && currentPlayerTrack?.videoId))} />
      <SongHistory historyVersion={historyVersion} visible={showHistory} onPlayFromHistory={playFromHistory} activeVideoId={isPlayer ? currentPlayerTrack?.videoId : null} media={media} />
      <PlaylistPanel visible={showPlaylist && appMode === 'live'} currentMedia={media} />
      <LibraryPanel
        visible={showPlaylist && appMode === 'player'}
        onPlayTrack={playTrack}
        onPlayFromLibrary={playFromHistory}
        onQueuePlaylist={queuePlaylist}
      />
      <YtMissesPanel visible={showMisses} />
      <PlayerControls
        visible={isPlayer}
        media={displayMedia}
        currentTrack={currentPlayerTrack}
        nextTrack={nextPlayerTrack}
        radioOn={radioOn}
        queuePosition={playerIndex}
        queueLength={playerQueue.length}
        isPlaying={playerState.playing}
        currentTime={playerState.currentTime}
        duration={playerState.duration}
        volume={playerState.volume}
        onPlayPause={() => {
          const controls = activeControls();
          if (!controls) return;
          const state = controls.getState?.();
          if (state?.playing) controls.pause?.();
          else controls.play?.();
        }}
        onPrev={prevTrack}
        onNext={handleNext}
        vote={currentPlayerTrack?.videoId ? (votes[currentPlayerTrack.videoId] || 0) : 0}
        onVote={handleVote}
        moodSlot={<MoodDisplay mood={mood} wildcard={wildcard} />}
        onSeek={(t) => activeControls()?.seek?.(t)}
        onVolume={(v) => activeControls()?.setVolume?.(v)}
      />
    </div>
  );
}
