# VisualAudioScraper — Evergreen Master Plan

## Identity

**From**: a Windows desktop audio scraper with pretty visualizers
**To**: an intelligent, containerized music player that sees, hears, and curates

---

## Where We Are Now

### What Works
- Live audio capture via WASAPI loopback (Windows-only `soundcard` lib)
- Chrome extension + WinRT media session for track detection
- 4 x 2D visualizers, 4 x 3D visualizers (Three.js)
- YouTube video background (IFrame API — live mode muted loop, player mode unmuted stream)
- Auto-enrichment pipeline: TheAudioDB/Wikipedia images, MusicBrainz genres, Pillow colors, YouTube search
- Player mode with queue, prev/next, seek, volume, "up next" (streams from YouTube, no local downloads)
- History panel with click-to-play-from-here
- Playlist CRUD, library panel

### What's Fragile
- `soundcard` requires WASAPI = Windows only, cannot run in a standard Docker container
- WinRT media session = Windows only
- Chrome window title scraping = Windows only
- No user accounts, no auth, single-machine only

---

## Phase 1 — Data Layer: JSON to SQLite (COMPLETE)

**Goal**: Replace every JSON file with a single SQLite database. Zero behavior change, but unlocks everything after.

**Status**: Done. All data lives in `backend/data/visualaudio.db` (WAL mode). JSON files eliminated.

### Tables
| Table | Replaces | Key Fields |
|-------|----------|------------|
| `tracks` | youtube_cache.json | `id`, `artist`, `title`, `album`, `genres`, `dominant_colors`, `video_id`, `video_title`, `duration`, `thumbnail_url`, `artist_images`, `created_at` |
| `play_history` | history.json | `id`, `track_id` FK, `played_at`, `source`, `duration_played` |
| `playlists` | playlists.json | `id`, `name`, `created_at`, `updated_at` |
| `playlist_tracks` | (nested in playlists.json) | `playlist_id` FK, `track_id` FK, `position` |
| `downloads` | download_status.json | `video_id`, `state`, `progress`, `file_size_mb`, `file_path`, `started_at`, `completed_at` |
| `artists` | artist_store per-artist .json | `id`, `name`, `slug`, `image_urls`, `bio`, `tags` |
| `choreography` | choreography.json | `track_id` FK, `timestamp_ms`, `event_type`, `data` |

### Migration Path
1. Write `db.py` — single module, `sqlite3`, one `get_db()` connection with WAL mode
2. Write migration script that reads all existing JSON → inserts into SQLite
3. Update each `*_store.py` to use `db.py` instead of JSON read/write
4. Delete JSON store logic, keep JSON files as backup until confident

### Why First
- SQLite is embeddable, zero-config, works in Docker
- Enables real queries: "play count by artist", "most played genre this week", "tracks I haven't heard in 30 days"
- Required for smart sequencing (Phase 4)

---

## Phase 2 — Containerization: Docker

**Goal**: Run the full stack (backend + frontend) in Docker, with audio input abstracted.

### The Audio Problem
`soundcard` uses WASAPI loopback which requires direct access to Windows audio hardware. Docker containers (even Windows containers) don't expose audio devices.

### Architecture

```
┌─────────────────────────────────────────────┐
│  Docker Container                           │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Vite/Nginx  │  │  Python Backend      │  │
│  │ (frontend)  │  │  - WebSocket server  │  │
│  │ :5173       │  │  - HTTP API :8766    │  │
│  │             │  │  - SQLite DB         │  │
│  │             │  │  - yt-dlp            │  │
│  │             │  │  - enrichment        │  │
│  └─────────────┘  └──────┬───────────────┘  │
│                          │ audio input API   │
│                          │ (no WASAPI)       │
└──────────────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │  Audio Sources (external)            │
        │  - Chrome extension POST /track      │
        │  - Host-side audio agent (optional)  │
        │  - Web Audio API (browser mic/tab)   │
        │  - Spotify/Last.fm API (scrobble)    │
        └─────────────────────────────────────┘
```

### Strategy: Decouple Audio Capture from the Server
1. **Make `soundcard` optional** — the backend already has multiple detection sources (extension, WinRT, fingerprint). Audio capture is one input, not the core.
2. **Create an Audio Input API** — `POST /audio-frame` accepting raw PCM or FFT data. A lightweight host-side agent (runs natively on Windows/Mac/Linux) captures audio and POSTs frames to the container.
3. **Chrome extension becomes primary** — it already detects tracks and can capture tab audio via `chrome.tabCapture`. Extend it to POST audio data for visualization.
4. **Web Audio API fallback** — browser microphone capture for "listen to the room" mode.

### Dockerfile Plan
- Multi-stage: Node build stage (frontend) → Python runtime stage (backend)
- Nginx serves built frontend + reverse proxies API/WS to Python
- Volume mount for `data/` (SQLite DB + downloaded videos)
- `yt-dlp` + `ffmpeg` included in image

### What Gets Left Behind (native-only features)
- WASAPI loopback (replaced by audio input API)
- WinRT media session (replaced by extension / scrobble APIs)
- Chrome window title scraping (replaced by extension)

---

## Phase 3 — Player Evolution

**Goal**: Go from "plays downloaded videos" to a real music player experience.

### 3a. Playback Sync (existing PLAN.md)
- Play/pause detection from WinRT + extension + silence
- WebSocket broadcast of playback state
- Visualizer freeze on pause
- YouTube background sync
- Paused UI badge

### 3b. Smart Queue Management
- Continuous playback: when queue ends, auto-fill with related tracks
- Shuffle mode (Fisher-Yates on queue copy)
- Repeat modes: off / one / all
- Drag-to-reorder queue
- "Play artist radio" — queue all tracks by same artist + similar

### 3c. Richer Player UI
- Full-screen player view (album art + visualizer + controls)
- Mini-player mode (collapsed bar, always visible)
- Keyboard shortcuts: space (play/pause), arrow keys (seek), N/P (next/prev)
- Media Session API integration (OS media controls, lock screen on mobile)

### 3d. Audio-Only Mode
- Not every track needs a video. When no YouTube result exists, visualizers are the primary visual.
- Future: stream audio-only via YouTube IFrame for tracks where video isn't useful.

---

## Phase 4 — The Brain: Intelligent Sequencing

**Goal**: The app learns what you like and builds sequences that flow.

### Data Signals (all from SQLite)
- **Play history**: what you play, how long, what you skip
- **Time patterns**: what you listen to at different times of day / week
- **Transitions**: which song→song transitions you let play vs skip
- **Genre/artist affinity**: weighted by recency and frequency
- **BPM and energy**: extracted from audio analysis (future)

### Sequencing Strategies
| Strategy | Description |
|----------|-------------|
| **Flow** | Match energy/BPM between adjacent tracks (smooth DJ-style transitions) |
| **Mood** | Group by genre + dominant colors (visual coherence) |
| **Discovery** | Interleave favorites with less-played tracks |
| **Time-aware** | Morning = calm, evening = upbeat (learned from history) |
| **Artist deep-dive** | Play an artist's catalog chronologically or by popularity |

### Implementation
1. **Local-first**: all logic runs in Python, no external AI API needed initially
2. **Scoring function**: `score(candidate, context)` → float, where context = last N tracks + time + user profile
3. **Genre/mood vectors**: MusicBrainz genres → embeddings (simple TF-IDF or pre-built mapping)
4. **Transition model**: track skip/play ratios for A→B pairs, smoothed with genre fallback
5. **Future**: plug in an LLM for "vibe" descriptions ("play something for a rainy Sunday afternoon")

---

## Phase 5 — Platform Growth

**Goal**: Multi-user, multi-source, deployed.

### 5a. Authentication & Multi-User
- Simple auth (JWT or session-based)
- Per-user history, playlists, preferences
- SQLite → PostgreSQL if needed (or keep SQLite per-user)

### 5b. Additional Music Sources
- Spotify Connect API (listen along, import playlists)
- Last.fm scrobble import
- Local file scanning (MP3/FLAC library)
- SoundCloud, Bandcamp link support

### 5c. Deployment
- Docker Compose: backend + frontend + reverse proxy
- Cloud deploy: Railway / Fly.io / self-hosted
- Mobile-responsive frontend (PWA)

### 5d. AI Collage Vision (Original Dream)
- Visualizers that blend artist images, album art, video frames, and generated imagery
- Real-time compositing driven by audio energy and beat detection
- Style transfer / AI image generation seeded by current track's mood
- A living, breathing visual experience unique to every listening session

---

## Dependency Map

```
Phase 1 (SQLite) ✅ COMPLETE
  └── Phase 2 (Docker) ─── unlocked by Phase 1
        └── Phase 5 (Platform) ─── requires Phase 2 (containerized)
  └── Phase 4 (Brain) ─── unlocked by Phase 1 (queryable history)

Phase 3 (Player) ─── independent, in progress
```

**Phase 1 is done.** Phase 2 and Phase 4 are now unblocked. Phase 3 is in progress. Phase 5 needs Phase 2.

---

## Completed JSON → SQLite Migration

All data now lives in `backend/data/visualaudio.db`:

| Former JSON File | SQLite Table |
|------------------|-------------|
| `history.json` | `play_history` + `tracks` |
| `playlists.json` | `playlists` + `playlist_tracks` |
| `youtube_cache.json` | `tracks` |
| `download_status.json` | `downloads` |
| `choreography.json` | `choreography` |
| `{artist-slug}.json` | `artists` |

---

## Guiding Principles

1. **Local-first** — everything works offline, no cloud dependency for core features
2. **Incremental** — each phase delivers value on its own, no big-bang rewrites
3. **Audio input is a pluggable concern** — the app's value is curation + visualization, not capture
4. **SQLite is the source of truth** — one file, portable, queryable, backupable
5. **The visualizers are the soul** — never sacrifice the visual experience for features
