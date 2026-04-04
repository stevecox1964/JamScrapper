# JamScrapper

A real-time music visualizer that captures system audio on Windows and renders it through interactive 2D and 3D visualizations in the browser. Think MTV built backwards — start from the music, figure out who's playing, then build the visuals around them.

## How It Works

A Python backend captures system audio via WASAPI loopback (anything playing through your speakers), runs FFT analysis, and streams frequency + waveform data over WebSocket at ~30fps. A React frontend renders it across 7 visualizer modes.

The backend also identifies what's playing via three methods:
- **Chrome extension** — reads track info directly from the player DOM on Pandora, Spotify, YouTube Music, SoundCloud, and others (highest priority source)
- **Windows media session** — reads "Now Playing" metadata from apps that expose it (Spotify desktop, YouTube Music, etc.)
- **Audio fingerprinting** (optional) — identifies songs from the audio signal via AcoustID/Chromaprint

Source priority is enforced: the extension is trusted over WinRT for 5 seconds after it last reported, preventing stale or mismatched Windows media sessions from overriding accurate DOM data.

When an artist is detected, the system fetches images, extracts dominant colors, pulls genre tags from MusicBrainz, looks up the album via MusicBrainz recording search, and builds a persistent artist profile stored in SQLite. Next time that artist plays, the profile loads instantly.

Every visualizer is infused with media — artist images, album art, and YouTube thumbnails replace plain geometric shapes. A YouTube music video plays as a background layer behind all modes, starting instantly via YouTube's IFrame API.

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

Player mode streams directly via the YouTube IFrame API — no local files needed. The visualizer overlay stays on top so FX layer over the video.

Player state (queue, position, volume) is persisted to SQLite — reloading the page or restarting the app picks up right where you left off.

## History Playback

Song history is playable:
- History entries are enriched with cached YouTube video metadata
- Click any history row with a known video to jump straight into Player mode
- Tracks without a cached YouTube result are shown as non-playable

## Visualizer Modes

**2D (Canvas)**
- **Bars** — Frequency spectrum with album art revealed through each bar, artist image floating in background
- **Waveform** — Audio waveform with artist images riding the curve, bobbing with the music
- **Radial** — Circular frequency display with album art at center, artist images orbiting around it

**3D (Three.js)**
- **Tunnel** — Fly-through tunnel with image panels rotating around the walls
- **Galaxy** — Particle galaxy with album art as the pulsing core, image chips in spiral arms
- **Terrain** — Wireframe terrain with album art sun and floating image billboards above the surface
- **Starfield** — Stars flying past camera with image cards streaking through the field

All modes render with transparent backgrounds so the YouTube music video bleeds through behind everything.

## Tech Stack

| Layer | Tech |
|-------|------|
| Audio Capture | Python, `soundcard` (WASAPI loopback) |
| Signal Processing | `numpy` (FFT, log-binning) |
| Transport | WebSocket at ~30fps |
| Media Detection | Chrome extension (DOM scraping + MediaSession), `winrt` (Windows "Now Playing") |
| Audio Fingerprinting | `pyacoustid` / Chromaprint (optional) |
| Artist Profiles | MusicBrainz genres + album lookup, TheAudioDB/Wikipedia images, Pillow color extraction |
| YouTube Search | `yt-dlp` (search + thumbnail caching) |
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
3. Track info appears in the bottom-left overlay
4. The music video streams instantly as a background layer (YouTube IFrame)
5. Pick a visualizer mode from the header selector
6. Toggle song history or playlist panels from the header
7. Switch to **Player** mode to stream playlists and history tracks with audio
8. Click any row in **History** with a known video to launch it instantly

### Optional: Audio Fingerprinting

To enable song identification from the audio signal (for apps that don't expose metadata):

1. Get a free API key at [acoustid.org](https://acoustid.org/)
2. Create `backend/.env` with `ACOUSTID_API_KEY=your_key`
3. Install [fpcalc](https://acoustid.org/chromaprint) and add to PATH

Without this, the app still works — it just relies on the Windows media session and Chrome extension for track detection.

## Project Structure

```
backend/
  server.py            - Audio capture, FFT, WebSocket, media polling, HTTP/static server
  db.py                - SQLite database layer (WAL mode, auto-init)
  playlist_store.py    - Playlist CRUD (SQLite)
  artist_store.py      - Artist profile persistence, color extraction, genre mapping (SQLite)
  fingerprinter.py     - Audio fingerprinting via AcoustID (optional)
  history_store.py     - Song play history logging (SQLite)
  media_cache.py       - YouTube video search and thumbnail caching via yt-dlp (SQLite)
  choreography_store.py - Choreography data persistence (SQLite)
  player_state_store.py - Player mode state persistence (queue, position, volume)
  migrate_json_to_sqlite.py - One-time migration from legacy JSON files
  data/
    visualaudio.db     - All app data (auto-created)
    media_cache/       - Cached thumbnails (auto-generated)
extension/
  manifest.json        - Chrome extension manifest (Manifest V3)
  content.js           - DOM scraper + MediaSession interceptor for streaming sites
frontend/
  src/
    config.js               - Centralized API/WebSocket URL config (dev vs production)
    App.jsx                 - Main app layout, mode switching
    components/
      Visualizer.jsx        - 2D canvas visualizers (passes media assets)
      ThreeVisualizer.jsx   - 3D Three.js visualizers (passes texture manager)
      TrackInfo.jsx         - Track info overlay with genres and colors
      ModeSelector.jsx      - Mode picker UI
      YouTubeBackground.jsx - Video background (YouTube IFrame, live + player modes)
      SongHistory.jsx       - Collapsible play history panel with playable rows
      PlaylistPanel.jsx     - Playlist management panel
      LibraryPanel.jsx      - Saved library + playlist playback panel (Player mode)
      PlayerControls.jsx    - Transport controls (play/pause, seek, volume, next/prev)
    hooks/
      useAudioWebSocket.js  - WebSocket data hook + /now-playing startup fallback
    utils/
      mediaTextureManager.js - Shared image/texture loading for all visualizers
    visualizers/             - Individual visualizer implementations
start.bat                - One-click launcher for backend + frontend (dev mode)
```

## Roadmap

- Beat detection for pulse/flash effects
- Keyboard shortcuts to cycle modes
- Fullscreen toggle
- Smooth transitions between modes
- Bass energy driving camera shake / color intensity in 3D modes
- Plugin architecture for community visualizers
- More visualizer modes (spectrum waterfall, DNA helix, etc.)
- Song-specific choreographed animations
- Smart queue/repeat/shuffle controls for Player mode

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
- Audio must be playing through the default output device
- Google Chrome with the extension installed (for web player track detection)
- `yt-dlp` on PATH (for YouTube search and thumbnails)
