# TODO

## Working
- YouTube music video streams instantly as background (IFrame API, muted loop in Live mode)
- Player mode streams YouTube videos with audio via IFrame API — no local downloads
- Playlist system (create, manage, persist in SQLite) — add any track with a YouTube video
- Library panel for browsing cached tracks and playlist queue playback
- Player controls (play/pause, seek, volume, next/prev)
- Chrome extension captures track info from Pandora, Spotify, YouTube Music, SoundCloud, and more
- Windows media session fallback for apps that expose "Now Playing" metadata
- YouTube search runs in parallel with artist enrichment for fastest possible video start
- Artist profile system (genres, colors, images, mood tags)
- Song history panel — card layout with thumbnail, artist image, genres, colors, album
- History updates in real-time (polls every 3s while open; enrichment fills in within seconds)
- Smooth track transitions — Live video fades to 20% while awaiting YouTube search for the new track, restores when it loads
- Playable history rows (click to stream from history)
- Track info overlay with album art and genres
- Audio fingerprinting module (needs AcoustID API key to activate)
- One-click `start.bat` launcher
- Player state persistence (queue, position, volume restored on reload)
- Extension source priority over WinRT (prevents stale Windows media session overrides)
- Normalized dedup keys (case-insensitive track matching)
- Stale enrichment guard (skipping tracks no longer overwrites current track's data)
- Single-instance enforcement in start.bat
- Aggressive YouTube search with fallback queries + retry logic

## Visualizer Modes
- **Video** — YouTube IFrame full-screen background
- **Starfield** — 3D stars + artist image cards (Three.js)

## Known Limitations
- Chrome extension must be installed manually (Developer mode, Load unpacked)
- Audio fingerprinting requires free AcoustID API key + fpcalc install
- Windows only (WASAPI loopback + WinRT)
- Player mode requires internet (streams from YouTube)
- Live mode videos are muted; Player mode streams with audio

## Next Up
- Repeat/shuffle toggles for Player mode
- Keyboard shortcuts to control playback and cycle modes
- Fullscreen toggle
- Smooth transitions between modes
- Playback sync (pause detection, visualizer freeze, paused UI badge)

## Future
- Smart queue auto-fill (related tracks when queue ends)
- Mood-based sequencing from play history
- Song-specific choreographed animations
- Docker containerization (decouple audio capture from server)
