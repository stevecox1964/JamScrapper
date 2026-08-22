# Taste

Steve's music profile. Read by `backend/radio.py` to steer Rando.

This is a living file with two authors:
- **Steve writes the truth.** Edit any line, any time. Nothing here is generated from a guess.
- **Claude writes observations**, always under "What the app has noticed", never in Steve's sections.

**When this file and the play history disagree, this file wins.** The history records what was
played. This file records what is wanted. They are not the same thing.

---

## Loved — always a good idea

_Artists or songs that are a yes regardless of mood. Rando should over-pick these._

- _(empty — tell Claude and it lands here)_

## Never again

_Artists, genres, or vibes to hard-exclude. This is usually the strongest signal in the file,
because it never saturates the way "I like this" does._

- _(empty)_

## Contexts

_"Vibing" is not one thing. Different states want different music._

| Context | What it wants | What it does not want |
|---|---|---|
| _(unnamed)_ | | |

## Notes and rules

_Anything that does not fit above. "No live versions." "Nothing over 7 minutes on a work day."
"Covers are fine, tribute bands are not." Plain English — Claude turns it into picker rules._

- _(empty)_

---

## What the app has noticed

_Claude's section. Observations from real behaviour, not opinions. Steve can delete any line
they disagree with — a deleted line is itself a signal and should not be re-added._

- **2026-08-21** — The library is being built deliberately. Steve is draining Pandora for a few
  more months to fill `tracks`, then intends to run this app standalone. So the song pool is a
  work in progress by design, and the current 624 tracks should not be treated as a finished
  taste sample.
- **2026-08-21** — Skipping early is a mood, not a ban. Steve was explicit: a skip means "not
  this song right now". Penalties must decay. Never build a permanent blacklist from skips.
- **2026-08-21** — No thumbs-up button. Steve's reasoning: eventually everything gets an up
  arrow, so the signal saturates and dies. Letting a song finish is the positive signal.

---

## Where the machine-readable version lives

This file is prose on purpose — it is for humans. The numbers live in SQLite:

- `play_history` — every track detected while draining Pandora (the pool being built)
- `rando_stats` — per-song behaviour from Rando itself: picks, finishes, skips, how long played
- `artists.genres` / `artists.mood_tags` — enrichment from MusicBrainz

`radio.py` reads the numbers. A human reads this.

---

## Status of the learning loop

**Live since 2026-08-21.** Every Rando play now writes to `rando_stats`:

| Event | What gets recorded | What it does |
|---|---|---|
| Song picked | `picks + 1`, `last_played_at` | marks it as recently heard, so it goes stale |
| Song finished | `finishes + 1` | lifts that song's weight, up to +60% |
| Song skipped | `skips + 1`, `played_seconds` | drops it, down to -60%, and pushes the session mood away from its genres |

Both directions saturate at 3 events (`TASTE_CAP`), so nothing becomes permanent or banned.

This table is the point of the next few months. The Pandora drain fills `tracks` with *what
exists*; `rando_stats` fills in *what is wanted*. When the drain stops, the second table is what
the app runs on.
