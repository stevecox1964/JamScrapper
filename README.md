# JamScrapper

A real-time music visualizer that captures system audio on Windows and renders it through interactive 2D and 3D visualizations in the browser. Think MTV built backwards — start from the music, figure out who's playing, then build the visuals around them.

## How It Works

A Python backend captures system audio via WASAPI loopback (anything playing through your speakers), runs FFT analysis, and streams frequency + waveform data over WebSocket at ~30fps. A React frontend renders it across 7 visualizer modes.

The backend also identifies what's playing via three methods:
- **Chrome extension** — reads track info directly from the player DOM on Pandora, Spotify, YouTube Music, SoundCloud, and others
- **Windows media session** — reads "Now Playing" metadata from apps that expose it (Spotify desktop, YouTube Music, etc.)
- **Audio fingerprinting** (optional) — identifies songs from the audio signal via AcoustID/Chromaprint

When an artist is detected, the system fetches images, extracts dominant colors, pulls genre tags from MusicBrainz, and builds a persistent visual profile stored as JSON. Next time that artist plays, the profile loads instantly.

## Visualizer Modes

**2D (Canvas)**
- **Bars** — Classic frequency spectrum bar graph
- **Waveform** — Real-time audio waveform display
- **Radial** — Circular frequency visualization

**3D (Three.js)**
- **Tunnel** — Fly-through tunnel that pulses with the beat
- **Galaxy** — Particle galaxy reacting to audio
- **Terrain** — Terrain mesh driven by frequency data
- **Starfield** — Star particles responding to the music

## Tech Stack

| Layer | Tech |
|-------|------|
| Audio Capture | Python, `soundcard` (WASAPI loopback) |
| Signal Processing | `numpy` (FFT, log-binning) |
| Transport | WebSocket at ~30fps |
| Media Detection | Chrome extension (DOM scraping), `winrt` (Windows "Now Playing") |
| Audio Fingerprinting | `pyacoustid` / Chromaprint (optional) |
| Artist Profiles | MusicBrainz genres, TheAudioDB/Wikipedia images, Pillow color extraction |
| Frontend | React 19, Vite |
| 3D Rendering | Three.js |

## Getting Started

### Prerequisites

- Windows 10/11
- Python 3.11+
- Node.js 18+
- Google Chrome (for the track detection extension)

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
Starts WebSocket on `ws://localhost:8765` and extension HTTP endpoint on `http://localhost:8766`.

**Frontend:**
```bash
cd frontend
npm run dev
```
Opens at `http://localhost:5173`.

### Usage

1. Run `start.bat` (or start backend + frontend manually)
2. Play audio on any supported streaming site (Pandora, Spotify, YouTube Music, etc.)
3. Track info appears in the bottom-left overlay and debug panel
4. Pick a visualizer mode from the header selector

### Optional: Audio Fingerprinting

To enable song identification from the audio signal (for apps that don't expose metadata):

1. Get a free API key at [acoustid.org](https://acoustid.org/)
2. Create `backend/.env` with `ACOUSTID_API_KEY=your_key`
3. Install [fpcalc](https://acoustid.org/chromaprint) and add to PATH

Without this, the app still works — it just relies on the Windows media session for track detection.

## Project Structure

```
backend/
  server.py          — Audio capture, FFT, WebSocket server, media polling, extension HTTP endpoint
  artist_store.py    — Artist profile persistence, color extraction, genre mapping
  fingerprinter.py   — Audio fingerprinting via AcoustID (optional)
  data/artists/      — Cached artist profiles (auto-generated)
extension/
  manifest.json      — Chrome extension manifest (Manifest V3)
  content.js         — DOM scraper + MediaSession interceptor for streaming sites
frontend/
  src/
    App.jsx          — Main app, mode switching, debug panel
    components/
      Visualizer.jsx      — 2D canvas visualizers
      ThreeVisualizer.jsx — 3D Three.js visualizers
      TrackInfo.jsx       — Track info overlay with genres + colors
      ModeSelector.jsx    — Mode picker UI
    hooks/
      useAudioWebSocket.js — WebSocket data hook
    visualizers/           — Individual visualizer implementations
start.bat              — One-click launcher for backend + frontend
```

## Roadmap

- Beat detection for pulse/flash effects
- Keyboard shortcuts to cycle modes
- Fullscreen toggle
- Smooth transitions between modes
- More visualizer modes
- Plugin architecture for community visualizers
- Song-specific choreographed animations

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
