# Playback Sync Implementation Plan

## Overview
Add play/pause state detection, broadcast, and sync across all layers — so visualizers freeze on pause, YouTube background syncs, and UI shows playback state.

## Steps

### 1. Backend: Add `playbackState` field + silence detection (`server.py`)
- Add `playbackState: "playing"` to `media_info` dict
- Add silence detection: track consecutive low-peak frames, flip to `"paused"` after ~10 silent frames (~333ms), back to `"playing"` when audio returns
- Extract WinRT `MediaPlaybackStatus` via `try_get_playback_info_async()` in the media session poll loop
- Add `POST /playback-state` HTTP endpoint for extension to report state changes instantly

### 2. Chrome Extension: Detect play/pause (`extension/content.js`)
- Intercept `HTMLMediaElement.prototype.play` and `.pause` — POST state to `/playback-state`
- Poll `navigator.mediaSession.playbackState` in the existing 1s DOM poll loop
- Send state changes to backend (debounced, only on change)

### 3. Frontend Hook: Expose playback state (`useAudioWebSocket.js`)
- Pass `playbackState` through to `media` state so components can react
- Ensure `dataRef.current.media.playbackState` is always up to date for visualizers

### 4. Visualizer Freeze (`Visualizer.jsx`, `ThreeVisualizer.jsx`)
- 2D: skip canvas render when `playbackState !== 'playing'` (keep last frame frozen)
- 3D: skip scene updates/render when paused (keep RAF loop alive for fast resume)

### 5. YouTube Player Sync (`YouTubeBackground.jsx`)
- `useEffect` on `media.playbackState`: call `pauseVideo()` / `playVideo()` on state change
- Also pause/resume local `<video>` element

### 6. Paused UI Badge (`TrackInfo.jsx`)
- Show "Paused" badge when `playbackState === 'paused'`
- Subtle fade animation
