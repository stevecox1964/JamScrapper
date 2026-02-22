# TODO - Pick up here

## Test media detection
- Play an actual song (Spotify desktop works best, or YouTube Music in Chrome)
- Restart backend: `cd backend && python server.py`
- Check terminal for "Now playing: Artist - Title" output
- Verify track info overlay appears in bottom-left of visualizer
- Verify artist background image loads behind visualizer

## If media detection doesn't work
- Pandora stations page won't trigger it (need actual song playing)
- Try Spotify desktop — it exposes full metadata + album art natively
- YouTube Music in Chrome should work via tab title parsing

## Future ideas
- Integrate artist images INTO the 3D visualizers (textured planes, particle textures)
- Add more visualizer modes (spectrum waterfall, DNA helix, etc.)
- Keyboard shortcuts to cycle modes
- Fullscreen toggle
- Smooth transitions between visualizer modes
