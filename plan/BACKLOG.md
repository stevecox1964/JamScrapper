# Backlog

Ideas that are agreed as worth doing, but not scheduled yet.
Newest at the top. Move an item into a handoff when work actually starts.

---

## Discovery — where new songs come from after Pandora

**Added:** 2026-08-23
**Status:** Agreed approach, not scheduled. No code written.
**Relates to:** `backend/media_cache.py`, `backend/video_downloader.py`,
`backend/artist_store.py`, `backend/radio.py`, `plan/TASTE.md`

### The problem

The library only grows when Pandora plays something we have never seen. Every other part of
the app is downstream of that one event. Rando does not find music — it re-shuffles the 624
tracks already on disk. When the Pandora drain ends, the library freezes.

Confirmed by reading the backend on 2026-08-23: **there is no discovery code at all.** Nothing
in `backend/*.py` contacts Last.fm, ListenBrainz, or any "artists like this" service.
`media_cache.search_youtube()` only runs *after* something else has already supplied an artist
and a title. Pandora is that something.

### What we have to build on

| Thing | Count | Note |
|---|---|---|
| `tracks` rows | 624 | anything here with a `video_id` is already a Rando candidate |
| distinct artists in `tracks` | 204 | the seed set for "who sounds like this" |
| `artists` profiles | 225 | already carry `genres` and `mood_tags` |
| downloaded videos | **252 complete**, 11.2 GB | avg **45 MB** per song (see note) |

The back half of the pipeline already exists and needs no changes:
`media_cache.search_youtube(artist, title)` → `tracks` row → `video_downloader` saves the mp4.
Discovery only has to answer one new question: **what artist and title do we look up next?**

### Proposed shape

New `backend/discovery.py`, following the `media_cache.py` / `artist_store.py` class shape
(constructor takes `conn`, blocking network calls marked for `asyncio.to_thread()`).

1. Pick a seed artist from the library. Weight by what actually got finished — `rando_stats`
   already holds finishes and skips per song, so a seed can mean "more of what worked".
2. Ask the API for similar artists. Drop any artist already in `tracks`.
3. Ask for that artist's top tracks. Take one — not the whole discography.
4. Filter against `plan/TASTE.md` **"Never again"** before spending anything. This is a hard
   exclude, applied at pick time, not after the download.
5. Hand `(artist, title)` to the existing `search_youtube` → download path.
6. Record the outcome either way in a new table, so nothing is ever suggested twice.

```sql
CREATE TABLE IF NOT EXISTS discovery (
    artist       TEXT NOT NULL,
    title        TEXT NOT NULL,
    seed_artist  TEXT NOT NULL,
    source       TEXT NOT NULL,   -- 'lastfm' | 'listenbrainz'
    state        TEXT NOT NULL,   -- 'suggested' | 'imported' | 'no_video' | 'excluded'
    reason       TEXT,            -- why excluded, or which yt query failed
    created_at   TEXT NOT NULL,
    PRIMARY KEY (artist, title)
);
```

### Which API

**Last.fm `artist.getSimilar` + `artist.getTopTracks`.** Free API key, one signup, no cost, and
the similarity data is built from real listening rather than editorial tags. This is the pick.

**ListenBrainz** needs no key at all and is the fallback if the key ever becomes a problem, but
its similarity coverage is thinner on the long-tail artists this library is full of. Do not build
for both up front — put the API call behind one function and swap it if Last.fm disappoints.

### Two things that will bite

**A flood will hijack Rando.** `radio.py::_candidates()` gives a never-played song the *maximum*
freshness boost. Import 200 songs at once and Rando plays almost nothing else for days. Import a
trickle — a handful per run, with a hard cap — and the new songs mix in instead of taking over.

**Disk.** 45 MB per song is measured, not guessed. Ten songs a day is about 13 GB a month.
Whatever the cap is, it should be a real number in the config, not left open.

The videos folder holds 466 files but only **252 are complete songs**. The rest is 68 `.fNNN.mp4`
yt-dlp fragments (1.4 GB) and 76 `.temp` / `.part` / `.ytdl` leftovers (0.09 GB) from downloads
that died and were never cleaned up or retried. Discovery must not add to that pile: a failed
download has to clean up after itself and say so. Note this also means the "389 mp4 files"
in the song-signatures item below is an overcount — it counted fragments as songs.

### Open questions — decide before building

- **Auto or approve?** Does a found song land in the library on its own, or sit in a queue for
  Steve to say yes to? Auto is less work and matches how Pandora fed the library. A queue is
  safer for disk and for taste, but it is a new bit of UI and a new habit to maintain.
- **What triggers a run?** A button, a nightly job, or "top up when the library gets stale".
- **Does a new song get marked as new?** A first play is an audition. Worth knowing whether a
  skip means "bad song" or "not right now" — `rando_stats` cannot tell those apart today.

### First step when this is picked up

Do not write the importer first. Write the *read-only* half: seed from the library, call Last.fm,
print the 20 artists it suggests that we do not already own. Look at that list. If it is good, the
rest is plumbing we already have. If it is junk, no download quota was spent finding out.

---

## ~~Rando plays do not feed the freshness signal~~ — DONE 2026-08-21

Fixed the same day it was written. `rando_stats.last_played_at` now feeds `_last_played()`
alongside `play_history`, so a song played on Rando reads as recently heard.

Kept for the finding that came with it: play **counts** are useless in this data — 682 history
rows for 681 distinct songs, so almost everything has been played exactly once. Recency is the
only usable signal from `play_history`. Do not reintroduce a count-based novelty score.

---

## Retire the visualizer path — NOT YET, and not without asking

**Added:** 2026-08-21
**Status:** Deliberately deferred. Do not act on this without Steve saying so.

### History

The project started as "can we get audio data out of Pandora". The answer was yes, and the
visualizers were the point. Then the interesting question moved to *what song is playing*, and
the visuals stopped mattering. Steve has kept the visualizer code on purpose, in case that
changes back. **Keeping it is a decision, not neglect.**

### What it currently costs

| Thing | Cost |
|---|---|
| `frontend/src/visualizers/*` | ~1350 lines, 7 renderers |
| `Visualizer.jsx` + `ThreeVisualizer.jsx` | 79 lines of plumbing |
| `three` dependency | 38 MB installed; the bulk of the 720 KB JS bundle |
| Backend FFT loop (`server.py:839`) | WASAPI capture + `np.fft.rfft` at 30 fps, permanently |

None of it blocks anything. It is not slowing down the Rando work.

### The natural moment to revisit

**When the Pandora drain ends.** Two reasons to wait for that one moment rather than cut twice:

1. The backend audio capture is not purely visual — it also feeds `fingerprinter.py`, the
   fallback song identifier used while draining. That fallback stays useful until the drain stops.
2. Once the app plays its own music standalone, there is no external audio to capture at all.
   The FFT loop, the fingerprinter, and the visualizers all become dead on the same day. One
   clean removal instead of two messy ones.

### Worth saying out loud

Git is already the "in case I thought differently" safety net. When the day comes, the code can
be deleted outright and recovered from history — it does not have to live in the working tree to
stay available. But that is Steve's call to make, not a cleanup to slip into another change.

---

## Song signatures — real audio features from the local video files

**Added:** 2026-08-21
**Status:** Not started — agreed approach, not scheduled
**Blocks:** "Playlists + mood steering for Rando" (below)
**Decision made:** compute locally from the files we already have. AcousticBrainz was
considered and rejected — frozen since 2022, patchy coverage, and we store artist MBIDs
but not per-song recording MBIDs, so it needs a lookup pass before it can even be queried.

### The problem this fixes

Rando's mood counter today is **genre-tag matching, not a real signature**. Genre tags are a
weak proxy: the live data contains tags like `british`, `american`, and `spotify boycott` that
say nothing about how a song sounds. Any "chill vs energetic" steering built on tags alone is
guessing. This item replaces the guess with measured numbers.

### What we already have

- **389 mp4 files on disk**, 13 GB, at `backend/data/media_cache/videos/{video_id}.mp4`
- **ffmpeg installed** (`ffmpeg version N-92621`) — can pull an audio track out of any of them
- `numpy` and `scipy` already installed
- `video_downloader.py` already auto-downloads every found video, so new songs arrive for free

### What is missing

- `librosa` and `soundfile` are not installed (`pip install librosa soundfile`)
- No table to hold the results
- No batch job, no incremental hook

### Proposed signature (per video_id, computed once)

| Field | What it means | Source |
|---|---|---|
| `bpm` | speed | `librosa.beat.beat_track` |
| `energy` | average loudness | RMS mean |
| `dynamics` | flat vs swelling | RMS standard deviation |
| `brightness` | dark/warm vs bright/sharp | spectral centroid mean |
| `key` + `mode` | major sounds happy, minor sounds sad | chroma + Krumhansl profile |
| `duration` | length | already in `tracks` |

New table, mirroring the existing store pattern in `db.py`:

```sql
CREATE TABLE IF NOT EXISTS signatures (
    video_id    TEXT PRIMARY KEY,
    bpm         REAL,
    energy      REAL,
    dynamics    REAL,
    brightness  REAL,
    key         TEXT,
    mode        TEXT,
    analysed_at TEXT NOT NULL
);
```

### Plan when picked up

1. `pip install librosa soundfile`, then add both to the requirements file.
2. New `backend/signature_store.py` following the `media_cache.py` / `artist_store.py` shape.
3. ffmpeg extracts 22 kHz mono wav to a temp file; librosa reads that. Do **not** hand mp4
   straight to librosa — it is slow and needs audioread.
4. Analyse a 60-second slice from the middle of the track, not the whole thing. Intros and
   outros skew every one of these numbers, and it cuts the batch time by roughly 4x.
5. One-time batch script over the 389 files. Rough estimate ~1 hour; must be resumable and must
   log every file it skips and why — a silent skip here is exactly the failure mode to avoid.
6. Hook into `video_downloader.py` so each new download is analysed on arrival.
7. Only then rewire `radio.py` scoring from genre overlap to signature distance.

### Open question deferred to build time

How to combine signature distance with the genre overlap that already works. Replace it,
or blend the two? Genre still carries information that audio does not (a cover version sounds
like the original but sits in a different scene). Likely both, weighted — but decide with the
data in front of you, not now.

---

## Playlists + mood steering for Rando

**Added:** 2026-08-21
**Status:** Not started — exploration needed before any code
**Relates to:** `backend/radio.py`, `backend/playlist_store.py`,
`frontend/src/components/PlaylistPanel.jsx`, and the `master_plan_sequencing` auto-memory note

### The idea

Rando currently walks the **whole library** with one hidden mood counter. Playlists and
Rando are two separate worlds right now. They should meet: a playlist should be able to
seed, bound, or steer the random walk, and the user should get a hand on the wheel
instead of only watching where the drift goes.

### Questions to explore (decide these before building)

**Scope — what does Rando draw from?**
- Whole library (today's behaviour)
- A chosen playlist only
- A playlist as the *centre of gravity*, with the rest of the library reachable via wildcards

**Steering — how does the user push the mood?**
- Nothing (today: mood is implicit, driven only by what played)
- A "more like this" / "less like this" pair of buttons that reweight the mood counter live
- Named mood presets (chill / energetic / dark / upbeat) mapped onto the genre vocabulary
- A visible mood display, so the drift stops being invisible — the backend already returns
  the top 5 mood genres in `/radio/next`, and nothing shows them yet

**Learning — does it remember?**
- Skips are signal. A song skipped in the first 20 s is a "less like this" the user already gave us.
- Should mood survive a backend restart? Today it does not (in-memory `Counter`).
- Should a good run be savable as a playlist? "That last hour was great, keep it."

**Playlist generation — the inverse direction**
- Let Rando *build* a playlist: run the walk 20 times headlessly, save the result as a named playlist.
- This turns the sequencing engine into a playlist author, which is the bigger prize.

### What already exists to build on

- `radio.py` mood `Counter`, decay, wildcard, and the recent-repeat `deque`
- `/radio/next` already returns `mood` (top 5 genres) and `wildcard` (bool) — both unused by the UI
- `playlist_store.py` CRUD + `playlists` / `playlist_tracks` tables
- 601 of 624 playable tracks carry genres; 225 artist profiles carry `genres` **and** `mood_tags`
  (`mood_tags` is enriched but nothing reads it yet — likely the cheapest win here)

### Known unknowns

- **This item is blocked on real song signatures — see the item above.** Mood steering built on
  genre tags alone is guessing, and the user called this out directly on 2026-08-21.
- Genre tags are MusicBrainz-flavoured and noisy — the live data contains junk tags like
  `spotify boycott` and country tags like `british` / `american` that carry no mood. A stop-list
  or a weighting pass is probably needed even after signatures land, wherever genre is still used.

### First step when this is picked up

Show the mood. Render the `mood` array that `/radio/next` already returns somewhere in the
player UI. Watching the drift for one listening session will answer most of the questions above
far faster than arguing about them on paper.
