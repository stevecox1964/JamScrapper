# TODO

## Working
- Audio capture + FFT streaming at 30fps
- 7 visualizer modes (bars, waveform, radial, tunnel, galaxy, terrain, starfield)
- All visualizers infused with artist images, album art, and YouTube thumbnails
- YouTube music video plays instantly as background (IFrame API)
- Videos saved automatically in background as they play (yt-dlp, up to 1080p)
- Seamless crossfade from YouTube stream to local MP4 when download completes
- Cached videos load instantly on repeat plays
- Download progress shown in track info overlay
- Offline playlist system (create, manage, persist as JSON)
- Chrome extension captures track info from Pandora, Spotify, YouTube Music, SoundCloud, and more
- Windows media session fallback for apps that expose "Now Playing" metadata
- YouTube search runs in parallel with artist enrichment for fastest possible video start
- Artist profile system (genres, colors, images, mood tags)
- Song history panel with play log
- Track info overlay with album art, genres, and save status
- Audio fingerprinting module (needs AcoustID API key to activate)
- One-click `start.bat` launcher
- HTTP server with Range support for local video seeking

## Known Limitations
- Chrome extension must be installed manually (Developer mode, Load unpacked)
- Audio fingerprinting requires free AcoustID API key + fpcalc install
- Windows only (WASAPI loopback)
- Videos are muted (audio comes from system capture, not the video file)

## Next Up
- Playlist playback (play saved videos in sequence)
- Beat detection (pulse effects on kicks, flash on snares)
- Keyboard shortcuts to cycle visualizer modes
- Fullscreen toggle
- Smooth transitions between modes
- Bass energy driving camera shake / color intensity in 3D modes

## Future
- Plugin architecture for drop-in visualizer engines
- Song-specific choreographed animations
- More visualizer modes (spectrum waterfall, DNA helix, etc.)
- Video quality selection (720p / 1080p / audio-only)
- Storage management UI (delete old videos, set size limits)
