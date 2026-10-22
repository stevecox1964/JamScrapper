# 002 — Slideshow shows pictures that are not the band

**Priority:** P2
**Status:** open
**Added:** 2026-10-21
**Closed:** _Not yet._

## Why

The band slideshow (`SyntheticVideo.jsx`) shows pictures with no link to the band. The user saw this for iiO on 2026-10-21, after the Topic-video fix (commit `ff08516`).

Play `play_history` id 1187 (iiO) had 23 pictures:

- 1 Deezer artist photo: good.
- 10 iTunes album covers: these look OK. They are exact artist-name matches.
- 12 Wikimedia Commons hits. Only 1 is the band (`Nadia_Ali_2010.jpg`). The others are wrong:
  - a hotel in Guarujá, Brazil (the file name contains "Iiº")
  - Festa de Iemanjá photos
  - Japanese people named Iio (Kazuki, Kazunori, Ryutaro)
  - a florists' magazine, a towel-map GIF, and a bird plate

The cause is the Commons search `"<artist>" filetype:bitmap`. It does full-text search. A short or common band name matches unrelated files.

## What "done" looks like

- When you play iiO, the slideshow shows no Commons pictures that are not iiO or its members.
- Massive Attack still gets its Commons concert photos. Before this change it had 12; after, it must still have most of them.
- The `[IMG]` log line shows how many pictures were dropped per source, so a drop to 0 is visible.

## Where to start

- `backend/server.py` `fetch_artist_images()`, the "Wikimedia Commons photos" block (around line 430).
- One idea: keep a Commons hit only when its file title contains the full artist name as a whole word. Or search Commons by the artist's Wikipedia/Wikidata category, not by full text.
- Test data: `play_history` ids 1187 (iiO, bad hits) and 1184 (Massive Attack, good hits).

## Watch out for

- `_image_cache` is in memory, so you must restart the backend to see a change.
- Older rows in `play_history.artist_images` keep the old picture lists. A fix applies only to new plays.
- Names with accents or symbols, for example "Sigur Rós", must still match.
