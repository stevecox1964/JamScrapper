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

## Open question (why it is on hold)

How do friends reach Steve's PC? Steve is uneasy about a public Cloudflare link.
Options to weigh:
- **Tailscale:** private network, invited friends only. Nothing public.
- **Small cloud server:** Steve's PC stays hidden. Costs setup and maybe money.
- **Cloudflare tunnel:** free public link to one port. Simplest, but public.

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
