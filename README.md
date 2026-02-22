# JamScrapper

A real-time music visualizer that captures system audio on Windows and renders it through interactive 2D and 3D visualizations in the browser. The long-term vision is to build song-specific animations that react to and interpret music.

## How It Works

A Python backend captures system audio via WASAPI loopback (anything playing through your speakers), runs FFT analysis, and streams the frequency + waveform data over WebSocket at ~30fps. A React frontend consumes that stream and renders it across 7 different visualizer modes.

The app also detects what song is currently playing via the Windows media session API, fetches artist imagery, and overlays track info on the visualizer.

## Visualizer Modes

**2D (Canvas)**
- **Bars** - Classic frequency spectrum bar graph
- **Waveform** - Real-time audio waveform display
- **Radial** - Circular frequency visualization

**3D (Three.js)**
- **Tunnel** - Fly-through tunnel that pulses with the beat
- **Galaxy** - Particle galaxy reacting to audio
- **Terrain** - Terrain mesh driven by frequency data
- **Starfield** - Star particles responding to the music

## Tech Stack

| Layer | Tech |
|-------|------|
| Audio Capture | Python, `soundcard` (WASAPI loopback) |
| Signal Processing | `numpy` (FFT, log-binning) |
| Transport | WebSocket (`websockets` library) |
| Media Detection | `winrt` (Windows "Now Playing" API) |
| Artist Images | TheAudioDB + Wikipedia fallback |
| Frontend | React 19, Vite |
| 3D Rendering | Three.js |

## Getting Started

### Prerequisites

- Windows 10/11
- Python 3.11+
- Node.js 18+

### Backend

```bash
cd backend
pip install -r requirements.txt
python server.py
```

The WebSocket server starts on `ws://localhost:8765`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`. Make sure the backend is running first.

### Usage

1. Start the backend
2. Start the frontend
3. Play any audio on your system (Spotify, YouTube, etc.)
4. Pick a visualizer mode from the selector

## Roadmap

- Song-specific animations and choreographed visuals
- Artist imagery integrated into 3D visualizers
- More visualizer modes (spectrum waterfall, DNA helix, etc.)
- Keyboard shortcuts to cycle modes
- Fullscreen toggle
- Smooth transitions between modes

## Requirements

- Windows only (WASAPI loopback + WinRT media session)
- Audio must be playing through the default output device
