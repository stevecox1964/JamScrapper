# Plan — Local-first playback

**Written:** 2026-10-08 · **Status:** planned, no code yet

## Goal

Local mode plays the video file we already saved, not the YouTube embed. YouTube is only
the backup when no file is on disk. The app's own player then owns everything: song
position, play/pause, song end, and listen time.

Outside music services (Pandora, any other) are kept only for picking new songs and for
cataloging. See memory `project_self_reliance`.

## Where we are today (checked 2026-10-08)

- Library: **647** songs with a YouTube id. **425** have a saved file
  (`backend/data/media_cache/videos/{id}.mp4`). **222** do not (34%).
- Local mode plays YouTube first. The saved file is only a rescue when YouTube refuses
  (`localFallbackId` in `App.jsx`, played by `LocalVideoPlayer.jsx`).
- On every new song, `App.jsx` resets `localFallbackId` to `''`, which means "try YouTube".
- The backend already serves the files with HTTP Range, so seeking works.
- **Risk found:** the backend HTTP server is `HTTPServer` (one request at a time,
  `server.py` line ~1465). A long video stream can block `/radio/next`, `/track`, and the
  rest until it finishes. Local-first makes this a daily problem, not a rare one.

## Steps

Each step is small and can be tested alone. Do them in order.

### Step 1 — Let the backend serve more than one request at a time

- `server.py`: `HTTPServer` → `ThreadingHTTPServer` (same module, one-line change).
- Check: the handlers that touch SQLite get their own connection, or are safe to run in
  threads. Read `get_db()` in `db.py` before changing anything.
- **Done when:** a video plays while Next and the history panel still respond at once.

### Step 2 — Play the saved file first

- `App.jsx`: on a new song, set the local id to the song's `videoId` (try the file first)
  instead of `''`.
- `LocalVideoPlayer` `onError` (no file, 404) → clear the local id, which hands the song to
  YouTube. This reverses today's order; the existing handlers stay, the order flips.
- YouTube error while the file was already tried → skip the song (today's dead-video path).
- `YouTubeBackground` must get **no** `playerTrack` while the file plays. Otherwise both
  play and you hear the song twice.
- Rename `localFallbackId` → `localPlayId` (it is no longer a fallback).
- **Done when:** a song with a file plays from disk (no YouTube iframe in the page), and a
  song without a file still plays from YouTube.

### Step 3 — Match the YouTube player's polish

Today only the YouTube player has these. The file player needs them too:
- Fade out in the last 3 seconds (`FADE_DURATION` in `YouTubeBackground.jsx`).
- Fade to black while paused.
- Volume kept between songs.
- **Done when:** song changes and pauses look the same for file and YouTube songs.

### Step 4 — Fill the gaps (the 222 songs with no file)

- A one-off backfill job: walk the library, download each missing video with the existing
  `video_downloader.py`, a few at a time, with a pause between downloads.
- Report at the end: downloaded, failed (with the yt-dlp reason), skipped. No silent skips.
- **Done when:** the report shows how many songs are now on disk, and why the rest failed.

### Step 5 — Stop Windows from reporting our own player as the live song

- In Local mode, the Windows media session sees the app's own video
  (seen 2026-10-08: "RushVEVO - Rush - Vital Signs") and the backend reports it as the live
  track. Once files play from disk this may go away by itself (no YouTube session in
  Chrome). Check after Step 2; fix only if it is still there.

### Step 6 — Listen time from our own player

- The player already knows position and duration. Send listen time to the backend when a
  song ends or is skipped (`/radio/finished`, `/radio/skip` already take `playedSeconds`).
- Check what is sent today and fill any gaps. This feeds mood sequencing
  (memory `project_kill_zone_mood_sequencing`: whole song played = interest).

## Not in this plan

- Live mode (Pandora) stays as it is. No new work on the Chrome extension.
- No change to how songs are picked (Rando / Local picker).

## Open question for the user

- Step 4 downloads about 222 videos. Run it all at once overnight, or a few each day?
