# JamScrapper

A real-time music player and video aggregator for Windows. It detects what's playing on your streaming apps, enriches it with artist metadata, and streams the music video behind a live visualizer — all without downloading anything.

## How It Works

A Python backend identifies what's playing via three detection methods:
- **Chrome extension** — reads track info directly from the player DOM on Pandora, Spotify, YouTube Music, SoundCloud, and others (highest priority)
- **Windows media session** — reads "Now Playing" metadata from apps that expose it (Spotify desktop, YouTube Music, etc.)
- **Audio fingerprinting** (optional) — identifies songs from the audio signal via AcoustID/Chromaprint

When a track is detected, the system immediately broadcasts it to the frontend, then enriches in the background: fetches artist images, extracts dominant colors, pulls genre tags from MusicBrainz, looks up the album, and finds the YouTube video. Source priority is enforced — the extension is trusted over WinRT for 5 seconds after it last reported, preventing stale Windows media sessions from overriding accurate DOM data.

All enrichment is non-blocking — track info appears instantly, metadata fills in as it arrives.

The track info card slides in from the left when a new song starts, then auto-retracts after a few seconds to keep the view clean. Hover to keep it open, or click the arrow tab to pull it back out anytime.

## Playlist System

Create playlists from any track that has a YouTube video:
- Add the currently playing track to any playlist with one click
- Create, delete, and manage multiple playlists
- Track metadata (artist, title, duration) stored alongside video IDs
- All playlist data persists in SQLite (`backend/data/visualaudio.db`)

## Player Mode

JamScrapper supports two workflows:
- **Live mode** — detect tracks from streaming apps, play muted YouTube video background
- **Player mode** — stream YouTube videos with audio, queue playlists, and auto-advance tracks

Player mode streams directly via the YouTube IFrame API — no local files needed. Player state (queue, position, volume) persists to SQLite and restores on reload.

## History Panel

The play history panel shows a live card view of recent tracks:
- Thumbnail, artist image, title, album, genres, and color palette per entry
- Updates in real-time as enrichment data arrives (thumbnail, genres, colors fill in within seconds)
- Click any playable entry to jump straight into Player mode
- New songs appear within ~3 seconds of detection

## Visualizer Modes

- **Video** — YouTube music video streams as the full-screen background (IFrame API)
- **Starfield** — 3D stars flying past camera with artist image cards streaking through the field (Three.js)

All modes render with transparent backgrounds so the YouTube video bleeds through.

## Tech Stack

| Layer | Tech |
|-------|------|
| Audio Capture | Python, `soundcard` (WASAPI loopback) |
| Signal Processing | `numpy` (FFT, log-binning) |
| Transport | WebSocket at ~30fps |
| Media Detection | Chrome extension (DOM scraping + MediaSession), `winrt` (Windows "Now Playing") |
| Audio Fingerprinting | `pyacoustid` / Chromaprint (optional) |
| Artist Profiles | MusicBrainz genres + album lookup, TheAudioDB/Wikipedia images, Pillow color extraction |
| YouTube Search | `yt-dlp` (aggressive fallback queries + retry + thumbnail caching) |
| Video Background | YouTube IFrame API (live: muted loop, player: unmuted with track-end detection) |
| Media Textures | Three.js textures + Canvas image rendering from artist/album/YouTube media |
| Data Layer | SQLite (WAL mode, single file) |
| Frontend | React 19, Vite |
| 3D Rendering | Three.js |

## Getting Started

### Prerequisites

- Windows 10/11
- Python 3.11+
- Node.js 18+
- Google Chrome (for the track detection extension)
- `yt-dlp` installed and on PATH (for YouTube search and thumbnails)

### Quick Start

```bash
# Install dependencies (first time only)
cd backend && pip install -r requirements.txt
cd ../frontend && npm install

# Run everything
start.bat
```

`start.bat` kills any stale processes on the required ports, waits for them to fully release, verifies the ports are free, then launches the backend, frontend dev server, and opens the browser automatically. If a port is still in use after cleanup, it exits with an error rather than launching a second instance.

### Production Build

Build the frontend and run only the Python backend:

```bash
cd frontend && npm run build
cd ../backend && python server.py
```

The backend serves the built frontend at `http://localhost:8766` and opens the browser automatically. No separate frontend server needed.

### Chrome Extension Setup

The extension reads track info from streaming sites. Install it once:

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. The extension auto-activates on supported streaming sites

### Manual Start (Dev)

**Backend:**
```bash
cd backend
python -W ignore server.py
```
Starts WebSocket on `ws://localhost:8765` and HTTP/API server on `http://localhost:8766`.

**Frontend (dev server with hot reload):**
```bash
cd frontend
npm run dev
```
Opens at `http://localhost:5173`. Connects to backend at `localhost:8765`/`8766`.

### Usage

1. Run `start.bat` (or start backend + frontend manually)
2. Play audio on any supported streaming site (Pandora, Spotify, YouTube Music, etc.)
3. Track info and music video appear automatically
4. Toggle song history or playlist panels from the header
5. Switch to **Player** mode to stream playlists and history tracks with audio
6. Click any row in **History** with a known video to launch it instantly

### Optional: Audio Fingerprinting

To enable song identification from the audio signal (for apps that don't expose metadata):

1. Get a free API key at [acoustid.org](https://acoustid.org/)
2. Create `backend/.env` with `ACOUSTID_API_KEY=your_key`
3. Install [fpcalc](https://acoustid.org/chromaprint) and add to PATH

Without this, the app still works — it relies on the Windows media session and Chrome extension for track detection.

## Project Structure

```
backend/
  server.py              - WebSocket, media polling, HTTP/static server, enrichment pipeline
  db.py                  - SQLite database layer (WAL mode, auto-init)
  playlist_store.py      - Playlist CRUD (SQLite)
  artist_store.py        - Artist profile persistence, color extraction, genre mapping
  fingerprinter.py       - Audio fingerprinting via AcoustID (optional)
  history_store.py       - Song play history logging (SQLite)
  media_cache.py         - YouTube video search and thumbnail caching via yt-dlp
  choreography_store.py  - Choreography data persistence
  player_state_store.py  - Player mode state persistence (queue, position, volume)
  data/
    visualaudio.db       - All app data (auto-created)
    media_cache/         - Cached thumbnails (auto-generated)
extension/
  manifest.json          - Chrome extension manifest (Manifest V3)
  content.js             - DOM scraper + MediaSession interceptor for streaming sites
frontend/
  src/
    config.js                 - Centralized API/WebSocket URL config (dev vs production)
    App.jsx                   - Main app layout, mode switching
    components/
      Visualizer.jsx          - 2D canvas visualizer host
      ThreeVisualizer.jsx     - 3D Three.js visualizer host
      TrackInfo.jsx           - Retractable track info card (auto-slides in/out)
      ModeSelector.jsx        - Mode picker (Video, Starfield)
      YouTubeBackground.jsx   - Video background (YouTube IFrame, live + player modes)
      SongHistory.jsx         - Live history panel with card layout and real-time updates
      PlaylistPanel.jsx       - Playlist management panel
      LibraryPanel.jsx        - Saved library + playlist playback panel (Player mode)
      PlayerControls.jsx      - Transport controls (play/pause, seek, volume, next/prev)
    hooks/
      useAudioWebSocket.js    - WebSocket data hook + /now-playing startup fallback
    utils/
      mediaTextureManager.js  - Shared image/texture loading for all visualizers
    visualizers/              - Individual visualizer implementations
start.bat                - One-click launcher for backend + frontend (dev mode)
```

## Roadmap

- Repeat/shuffle toggles for Player mode
- Keyboard shortcuts to cycle modes / control playback
- Fullscreen toggle
- Smooth transitions between modes
- Playback sync (pause detection, visualizer freeze, paused UI badge)
- Smart queue auto-fill (related tracks when queue ends)
- Mood-based sequencing from play history

## Supported Streaming Sites

The Chrome extension detects tracks from:
- Pandora
- Spotify (web player)
- YouTube Music
- SoundCloud
- Tidal, Deezer, Amazon Music, Apple Music (web players)

The Windows media session fallback works with any app that exposes "Now Playing" metadata.

## Requirements

- Windows only (WASAPI loopback + WinRT media session)
- Google Chrome with the extension installed (for web player track detection)
- `yt-dlp` on PATH (for YouTube search and thumbnails)
