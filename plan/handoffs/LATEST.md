# Latest handoff

See: [HANDOFF_2026-09-02_2147.md](HANDOFF_2026-09-02_2147.md)

**TL;DR:** Every song now has measured audio numbers (`signatures`, 389 rows) and Claude mood
labels (`moods`, 637 rows: energy/valence/tension 1–10 + fixed mood words). Nothing reads them
yet. User's killer feature: Next steers the mood, following songs match it, a whole song played
= interest. Next: rewire `backend/radio.py` scoring to mood distance.
