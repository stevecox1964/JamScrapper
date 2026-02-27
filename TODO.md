# TODO

## Working
- Audio capture + FFT streaming at 30fps
- 7 visualizer modes (bars, waveform, radial, tunnel, galaxy, terrain, starfield)
- All visualizers infused with artist images, album art, and YouTube thumbnails
- YouTube music video playing as muted background behind all modes
- Chrome extension captures track info from Pandora, Spotify, YouTube Music, SoundCloud, and more
- Windows media session fallback for apps that expose "Now Playing" metadata
- Artist profile system (genres, colors, images, mood tags)
- Song history panel with play log
- Track info overlay with album art, genres, and YouTube link
- Audio fingerprinting module (needs AcoustID API key to activate)
- One-click `start.bat` launcher
- Debug panel in UI showing live media detection state

## Known Limitations
- Chrome extension must be installed manually (Developer mode, Load unpacked)
- Audio fingerprinting requires free AcoustID API key + fpcalc install
- Windows only (WASAPI loopback)

## Next Up
- Beat detection (pulse effects on kicks, flash on snares)
- Keyboard shortcuts to cycle visualizer modes
- Fullscreen toggle
- Smooth transitions between modes
- Bass energy driving camera shake / color intensity in 3D modes

## Future
- Plugin architecture for drop-in visualizer engines
- Song-specific choreographed animations
- More visualizer modes (spectrum waterfall, DNA helix, etc.)
