# JamScrapper

A real-time music visualizer that captures system audio on Windows and renders it through interactive 2D and 3D visualizations in the browser. Think MTV built backwards — start from the music, figure out who's playing, then build the visuals around them.

## How It Works

A Python backend captures system audio via WASAPI loopback (anything playing through your speakers), runs FFT analysis, and streams frequency + waveform data over WebSocket at ~30fps. A React frontend renders it across 7 visualizer modes.

The backend also identifies what's playing via three methods:
- **Chrome extension** — reads track info directly from the player DOM on Pandora, Spotify, YouTube Music, SoundCloud, and others
- **Windows media session** — reads "Now Playing" metadata from apps that expose it (Spotify desktop, YouTube Music, etc.)
- **Audio fingerprinting** (optional) — identifies songs from the audio signal via AcoustID/Chromaprint

When an artist is detected, the system fetches images, extracts dominant colors, pulls genre tags from MusicBrainz, and builds a persistent visual profile stored as JSON. Next time that artist plays, the profile loads instantly.

Every visualizer is infused with media — artist images, album art, and YouTube thumbnails replace plain geometric shapes. A YouTube music video plays as a background layer behind all modes, starting instantly via YouTube's IFrame API. Videos are automatically saved locally in the background as they play. Once a video finishes downloading, playback seamlessly crossfades to the local copy — no buffering, no interruptions.

## Video Pipeline

When a track is detected, the backend searches YouTube in parallel with artist enrichment so the video starts as fast as possible:

1. **Instant playback** — YouTube IFrame loads and plays the music video immediately (muted)
2. **Background save** — `yt-dlp` downloads the MP4 in the background (up to 1080p)
3. **Seamless switch** — Once the download completes, playback crossfades to the local file
4. **Cached for next time** — If the same song plays again, the local video loads instantly

Download progress is shown in the track info overlay. Videos are stored in `backend/data/media_cache/videos/`.

## Playlist System

Create offline playlists from downloaded videos:
- Add currently playing tracks to any playlist
- Create, delete, and manage multiple playlists
- Track metadata (artist, title, duration) stored alongside video references
- All playlist data persists as JSON in `backend/data/playlists.json`

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
| Artist Profiles | MusicBrainz genres, TheAudioDB/Wikipedia images, Pillow color extraction |
| YouTube Search | `yt-dlp` (search + thumbnail caching) |
| Video Download | `yt-dlp` (MP4 up to 1080p, progress tracking) |
| Video Background | YouTube IFrame API (instant playback) → local MP4 (crossfade on download complete) |
| Media Textures | Three.js textures + Canvas image rendering from artist/album/YouTube media |
| Playlists | JSON persistence, per-track metadata |
| Frontend | React 19, Vite |
| 3D Rendering | Three.js |

## Getting Started

### Prerequisites

- Windows 10/11
- Python 3.11+
- Node.js 18+
- Google Chrome (for the track detection extension)
- `yt-dlp` installed and on PATH (for video search, thumbnails, and saving)

### Quick Start

```bash
# Install dependencies (first time only)
cd backend && pip install -r requirements.txt
cd ../frontend && npm install

# Run everything
start.bat
```

`start.bat` launches the backend, frontend, and opens the browser automatically.

### Chrome Extension Setup

The extension reads track info from streaming sites. Install it once:

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. The extension auto-activates on supported streaming sites

### Manual Start

**Backend:**
```bash
cd backend
python -W ignore server.py
```
Starts WebSocket on `ws://localhost:8765` and HTTP server on `http://localhost:8766`.

**Frontend:**
```bash
cd frontend
npm run dev
```
Opens at `http://localhost:5173`.

### Usage

1. Run `start.bat` (or start backend + frontend manually)
2. Play audio on any supported streaming site (Pandora, Spotify, YouTube Music, etc.)
3. Track info appears in the bottom-left overlay
4. The music video plays instantly as a background layer
5. Videos are saved automatically — download progress shows in the track overlay
6. Pick a visualizer mode from the header selector
7. Toggle song history or playlist panels from the header

### Optional: Audio Fingerprinting

To enable song identification from the audio signal (for apps that don't expose metadata):

1. Get a free API key at [acoustid.org](https://acoustid.org/)
2. Create `backend/.env` with `ACOUSTID_API_KEY=your_key`
3. Install [fpcalc](https://acoustid.org/chromaprint) and add to PATH

Without this, the app still works — it just relies on the Windows media session and Chrome extension for track detection.

## Project Structure

```
backend/
  server.py            — Audio capture, FFT, WebSocket, media polling, HTTP server
  video_downloader.py  — YouTube video download with progress tracking (yt-dlp)
  playlist_store.py    — Playlist CRUD and persistence (JSON)
  artist_store.py      — Artist profile persistence, color extraction, genre mapping
  fingerprinter.py     — Audio fingerprinting via AcoustID (optional)
  history_store.py     — Song play history logging (JSON)
  media_cache.py       — YouTube video search and thumbnail caching via yt-dlp
  data/artists/        — Cached artist profiles (auto-generated)
  data/history.json    — Play history log (auto-generated)
  data/playlists.json  — Saved playlists (auto-generated)
  data/media_cache/    — Cached thumbnails + downloaded videos (auto-generated)
extension/
  manifest.json        — Chrome extension manifest (Manifest V3)
  content.js           — DOM scraper + MediaSession interceptor for streaming sites
frontend/
  src/
    App.jsx            — Main app layout, mode switching
    components/
      Visualizer.jsx        — 2D canvas visualizers (passes media assets)
      ThreeVisualizer.jsx   — 3D Three.js visualizers (passes texture manager)
      TrackInfo.jsx         — Track info overlay with genres, colors, save progress
      ModeSelector.jsx      — Mode picker UI
      YouTubeBackground.jsx — Video background (YouTube IFrame → local MP4 crossfade)
      SongHistory.jsx       — Collapsible play history panel
      PlaylistPanel.jsx     — Offline playlist management panel
    hooks/
      useAudioWebSocket.js  — WebSocket data hook with media change detection
    utils/
      mediaTextureManager.js — Shared image/texture loading for all visualizers
    visualizers/             — Individual visualizer implementations
start.bat                — One-click launcher for backend + frontend
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
- Playlist playback (play saved videos in sequence)

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
- `yt-dlp` on PATH (for YouTube search and video saving)
