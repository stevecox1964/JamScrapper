# Latest handoff

See: [HANDOFF_2026-08-26_1922.md](HANDOFF_2026-08-26_1922.md)

**TL;DR:** Live background video does not swap when Pandora starts a new song. No fix yet —
this session only added `[VIDSWAP]` logging to both `backend/server.py` and
`frontend/src/components/YouTubeBackground.jsx`. Two suspects: the backend never finds the
new video id, or the `loop`/`playlist` player vars fight `loadVideoById()`. Next: user runs
one real Pandora test and pastes both consoles. Nothing is committed.
