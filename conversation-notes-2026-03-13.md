# Conversation Notes — March 13, 2026

## Artist Background Fix (Completed)
When no video content is present, the app was showing a blurry, barely-visible artist background (blur 30px, opacity 0.12). Fixed so artist images show clearly when no video is available:
- Added `hasVideo` prop to `TrackInfo` component
- `.artist-bg.no-video` class: `opacity: 0.45`, no blur, `brightness(0.7)`
- Smooth CSS transition when video loads/unloads
- Files changed: `App.jsx`, `TrackInfo.jsx`, `App.css`

## Project Vision (Saved to Memory)
Big picture goal: build an AI collage of images and videos driven by music.

## Reverse Music Control Discussion
Explored controlling the music source from the web app (play/pause/skip):
- **Chrome Extension**: Already runs in page context (`world: "MAIN"`), could click play/pause on YouTube/Spotify or trigger `navigator.mediaSession` action handlers
- **WinRT SystemMediaTransportControls**: Easiest win — already have `winrt-*` packages, can send play/pause/skip system-wide (works with any app)
- **Spotify/YouTube APIs**: Spotify Web API needs OAuth; YouTube IFrame API already in use via `YouTubeBackground.jsx`
- **Recommendation**: WinRT route is quickest — expose commands over WebSocket, add frontend buttons

## Docker / Multi-OS Discussion
Explored containerizing for cross-platform support:
- **Problem**: `soundcard` (WASAPI loopback) and WinRT media session are Windows-only, won't work in a container
- **Proposed architecture**: Split into host-side audio agent + containerized backend/frontend
  ```
  Host:   audio-agent (per-OS: soundcard on Windows, PulseAudio on Linux, BlackHole on Mac)
  Docker: backend (enrichment, history, playlists, video downloads, WebSocket relay)
  Docker: frontend (Vite/React)
  ```
- **Alternative**: Skip Docker, use a platform abstraction layer in Python instead
- **Key decision**: How to handle audio capture across OSes

## Pending / Not Yet Started
- **Playback Sync** — Full plan in `playback-sync-plan.md` (user approved "Full sync" scope)
- Reverse music control implementation
- Multi-OS / Docker containerization
