# TODO

## Working
- Audio capture + FFT streaming at 30fps
- 7 visualizer modes (bars, waveform, radial, tunnel, galaxy, terrain, starfield)
- All visualizers infused with artist images, album art, and YouTube thumbnails
- YouTube music video streams instantly as background (IFrame API, muted loop in Live mode)
- Player mode streams YouTube videos with audio via IFrame API — no local downloads
- Playlist system (create, manage, persist in SQLite) — add any track with a YouTube video
- Library panel for browsing cached tracks and playlist queue playback
- Player controls (play/pause, seek, volume, next/prev)
- Backend `/library` endpoint backed by media_cache (all YouTube-searched tracks)
- Chrome extension captures track info from Pandora, Spotify, YouTube Music, SoundCloud, and more
- Windows media session fallback for apps that expose "Now Playing" metadata
- YouTube search runs in parallel with artist enrichment for fastest possible video start
- Artist profile system (genres, colors, images, mood tags)
- Song history panel with play log
- Playable history rows (click to stream from history)
- Track info overlay with album art and genres
- Audio fingerprinting module (needs AcoustID API key to activate)
- One-click `start.bat` launcher
- Backend `/now-playing` snapshot endpoint for startup sync
- Backend `/history/playable` endpoint for history-to-player flow
- Faster live detection/transition cadence (WinRT + extension polling tuned)
- Player state persistence (queue, position, volume restored on reload)
- Extension source priority over WinRT (prevents wrong artist from stale Windows media session)
- Normalized dedup keys (case-insensitive track matching stops artist/title flipping)
- Stale enrichment guard (skipping tracks no longer overwrites current track's data)
- Single-instance enforcement in start.bat (port-free check before launch)
- Aggressive YouTube search with fallback queries (official video → music video → bare → artist-only)
- YouTube search retry (2 attempts with 5s delay between) + stale-track abort

## Known Limitations
- Chrome extension must be installed manually (Developer mode, Load unpacked)
- Audio fingerprinting requires free AcoustID API key + fpcalc install
- Windows only (WASAPI loopback)
- Player mode requires internet (streams from YouTube)
- Live mode videos are muted; Player mode streams with audio

## Next Up
- Repeat/shuffle toggles for Player mode
- Beat detection (pulse effects on kicks, flash on snares)
- Keyboard shortcuts to cycle visualizer modes
- Fullscreen toggle
- Smooth transitions between modes
- Bass energy driving camera shake / color intensity in 3D modes

## Future
- Plugin architecture for drop-in visualizer engines
- Song-specific choreographed animations
- More visualizer modes (spectrum waterfall, DNA helix, etc.)
- Playback sync (pause detection, visualizer freeze, paused UI badge)
