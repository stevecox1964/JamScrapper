# 001 — Jam Room: friends watch, add songs, chat and talk

**Priority:** P2
**Status:** open
**Added:** 2026-09-30
**Closed:** _Not yet._

## Why

A serious ask. Steve wants friends to join what he plays in player mode.
No Pandora. No audio re-streaming. Only his YouTube picks.

## The idea

- **Watch party:** each friend's browser plays the same YouTube video, synced to Steve's.
- **Jam:** friends who run the same app can add songs to a shared up-next list.
- **Chat:** text chat in the room.
- **Voice:** friends can talk (later).

## Design direction (2026-09-30)

Steve is fine with writing a server and putting it in the cloud.
Steve does not want Cloudflare (or any tunnel) baked into the design.

So: **a small standalone room server in the cloud.**
- Everyone connects *out* to it: Steve's app, friends' apps, browser guests.
- Steve's PC opens no ports. Nothing points into Steve's PC.
- The room server only knows rooms, sync, jam queue and chat. It holds no library, no files.
- Steve's app is just the first member with host rights (it sends sync; others follow).
- The room URL is one setting in `frontend/src/config.js`. Same code runs on localhost for testing.
- Host: any cheap always-on box (AWS Lightsail, Fly.io, a small VPS). RunPod is for GPUs; not needed.
- Voice later: WebRTC, set up through the same room server. Add a TURN relay only if some friends can't connect.

Still to decide when this is picked up: which cloud host, and how friends log in (room code vs accounts).

## What "done" looks like

- A friend opens a link, enters a room code, clicks Join, and sees and hears Steve's video in sync (within ~2 s).
- A friend adds a song. It plays next for everyone.
- Everyone can chat. Later, everyone can talk.

## Where to start

Full draft plan: `C:\Users\user\.claude\plans\transient-hatching-tome.md`.
Key hooks already in the code:
- `frontend/src/components/YouTubeBackground.jsx` (~lines 130-140) has play/pause/seek.
- `frontend/src/App.jsx` (~line 117) already saves player state on every change. Send room sync from there.
- `backend/server.py` binds 8765/8766 to `localhost` only. Keep it that way. Put the room on its own port.

## Watch out for

- Never expose `/library`, `/playlists`, votes or history to guests.
- Guest picks must not change Steve's votes or taste stats (`backend/radio.py`).
- Browsers block sound until the guest clicks once.
