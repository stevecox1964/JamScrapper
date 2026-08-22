"""Radio DJ — genre-drift random song picker.

Picks the next song with weighted randomness instead of a plain shuffle:
songs sharing genres with the recent mood win more often, but never always.
A wildcard pick every so often takes the mood out of the current genre, and
the decaying mood counter pulls it back in over the next few songs.
"""

import json
import math
import random
import re
from collections import Counter, deque
from datetime import datetime, timezone

# --- tuning knobs -----------------------------------------------------------
WILDCARD_CHANCE = 0.18   # how often we ignore genre entirely ("out")
MOOD_DECAY = 0.75        # how fast old genres fade (higher = longer memory)
SHARPNESS = 2.0          # >1 favours strong genre matches harder
BASELINE_WEIGHT = 0.05   # every song keeps a small chance, even with no match
RECENT_MEMORY = 40       # songs to avoid repeating
MOOD_KEEP = 24           # genres to keep in the mood counter
NOVELTY_BOOST = 1.5      # extra weight for songs you have not heard in a long time
NOVELTY_HORIZON = 90.0   # days; past this, a song counts as fully "new" again
SKIP_PENALTY = 1.2       # mood pushed away from a skipped song's genres
SKIP_GRACE = 45.0        # seconds; a skip after this long is not a complaint
TASTE_WEIGHT = 0.6       # how hard long-term like/dislike bends the pick
TASTE_CAP = 3            # finishes or skips past this stop adding weight


def _slugify(name):
    """Match ArtistStore.slugify so we can join on the artists table."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower().strip())
    return slug.strip("-") or "unknown"


def _parse_genres(raw):
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        return []
    return [str(g).strip().lower() for g in value if str(g).strip()]


class RadioDJ:
    def __init__(self, conn):
        self._conn = conn
        self._mood = Counter()
        self._recent = deque(maxlen=RECENT_MEMORY)

    # ---------- genre lookup ----------

    def _last_played(self):
        """(artist, title) -> days since it was last played.

        Play counts are useless here: the history is a detection log, so almost
        every song in it appears exactly once. How *long ago* is the real signal.
        """
        now = datetime.now(timezone.utc)
        ages = {}
        for row in self._conn.execute(
            "SELECT artist, title, played_at FROM play_history"
        ):
            try:
                when = datetime.fromisoformat(row["played_at"])
            except (TypeError, ValueError):
                continue
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            days = max(0.0, (now - when).total_seconds() / 86400.0)
            key = ((row["artist"] or "").lower(), (row["title"] or "").lower())
            # Keep the most recent play — that's the one that makes it stale.
            if key not in ages or days < ages[key]:
                ages[key] = days

        # Rando's own plays count too, otherwise a song hammered here yesterday
        # still reads as stale tomorrow.
        for row in self._conn.execute(
            "SELECT artist, title, last_played_at FROM rando_stats "
            "WHERE last_played_at IS NOT NULL"
        ):
            try:
                when = datetime.fromisoformat(row["last_played_at"])
            except (TypeError, ValueError):
                continue
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            days = max(0.0, (now - when).total_seconds() / 86400.0)
            key = ((row["artist"] or "").lower(), (row["title"] or "").lower())
            if key not in ages or days < ages[key]:
                ages[key] = days
        return ages

    def _genre_index(self):
        """Return (per_song, per_artist) genre maps, both keyed by lowercase names."""
        per_song = {}
        for row in self._conn.execute(
            "SELECT artist, title, genres FROM play_history "
            "WHERE genres NOT IN ('', '[]') ORDER BY played_at"
        ):
            genres = _parse_genres(row["genres"])
            if genres:
                key = ((row["artist"] or "").lower(), (row["title"] or "").lower())
                per_song[key] = genres

        per_artist = {}
        for row in self._conn.execute("SELECT slug, genres FROM artists"):
            genres = _parse_genres(row["genres"])
            if genres:
                per_artist[row["slug"]] = genres

        return per_song, per_artist

    def _candidates(self):
        """Every playable track, with its best-known genre list attached."""
        per_song, per_artist = self._genre_index()
        ages = self._last_played()
        taste = self._taste()
        tracks = []
        for row in self._conn.execute(
            "SELECT video_id, artist, title, video_title, duration FROM tracks "
            "WHERE video_id IS NOT NULL AND video_id != ''"
        ):
            artist = row["artist"] or ""
            title = row["title"] or ""
            genres = (
                per_song.get((artist.lower(), title.lower()))
                or per_artist.get(_slugify(artist))
                or []
            )
            # Never played at all counts as maximally stale, so it gets the boost.
            days = ages.get((artist.lower(), title.lower()), NOVELTY_HORIZON)
            freshness = min(1.0, days / NOVELTY_HORIZON)
            tracks.append({
                "videoId": row["video_id"],
                "artist": artist,
                "title": title,
                "videoTitle": row["video_title"] or "",
                "duration": row["duration"] or 0,
                "genres": genres,
                "daysSincePlay": round(days, 1),
                "novelty": 1.0 + NOVELTY_BOOST * freshness,
                "taste": taste.get(row["video_id"], 1.0),
            })
        return tracks

    # ---------- mood ----------

    def _score(self, genres):
        """Overlap between a song's genres and the current mood, 0..1-ish."""
        if not genres or not self._mood:
            return 0.0
        total = sum(self._mood.values()) or 1.0
        hit = sum(self._mood.get(g, 0.0) for g in genres)
        # Divide by sqrt so songs tagged with 20 genres don't always win.
        return (hit / total) / math.sqrt(len(genres))

    def _absorb(self, genres):
        """Decay the mood, then fold in what just played."""
        for genre in list(self._mood):
            self._mood[genre] *= MOOD_DECAY
            if self._mood[genre] < 0.01:
                del self._mood[genre]
        for genre in genres:
            self._mood[genre] += 1.0
        for genre, _ in self._mood.most_common()[MOOD_KEEP:]:
            del self._mood[genre]

    def skip(self, artist, title, video_id="", played_seconds=0.0):
        """The user skipped this song. Push the mood away from it — gently.

        A skip is a mood, not a ban: the penalty decays like everything else, and
        the later you skipped, the less it counts. Skipping past SKIP_GRACE
        seconds means you mostly heard it, so it says nothing.
        """
        strength = max(0.0, 1.0 - (float(played_seconds or 0.0) / SKIP_GRACE))
        if video_id and video_id not in self._recent:
            self._recent.append(video_id)
        # Log it either way — how long you sat with a song is data even when
        # the skip was too late to count as a complaint.
        self._record(video_id, artist, title,
                     skips=1 if strength > 0 else 0,
                     played_seconds=float(played_seconds or 0.0))
        if strength <= 0.0:
            return 0.0, []

        per_song, per_artist = self._genre_index()
        genres = (
            per_song.get(((artist or "").lower(), (title or "").lower()))
            or per_artist.get(_slugify(artist))
            or []
        )
        for genre in genres:
            self._mood[genre] -= strength * SKIP_PENALTY
            if self._mood[genre] <= 0.01:
                del self._mood[genre]
        return strength, genres

    def seed(self, artist, title):
        """Start the walk from a song the user is already hearing."""
        if self._mood:
            return
        per_song, per_artist = self._genre_index()
        genres = (
            per_song.get(((artist or "").lower(), (title or "").lower()))
            or per_artist.get(_slugify(artist))
            or []
        )
        if genres:
            self._absorb(genres)

    # ---------- long-term behaviour ----------

    def _record(self, video_id, artist="", title="", picks=0, finishes=0,
                skips=0, played_seconds=0.0):
        """Fold one listening event into rando_stats. Never overwrites, only adds."""
        if not video_id:
            return
        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            "INSERT INTO rando_stats "
            "(video_id, artist, title, picks, finishes, skips, played_seconds, last_played_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(video_id) DO UPDATE SET "
            "  picks = picks + excluded.picks,"
            "  finishes = finishes + excluded.finishes,"
            "  skips = skips + excluded.skips,"
            "  played_seconds = played_seconds + excluded.played_seconds,"
            "  last_played_at = excluded.last_played_at",
            (video_id, artist, title, picks, finishes, skips, played_seconds, now),
        )
        self._conn.commit()

    def _taste(self):
        """video_id -> multiplier from how you have treated this song before.

        Finishing a song lifts it, skipping drops it, and both saturate quickly
        so a handful of plays cannot make a song permanent or banned.
        """
        taste = {}
        for row in self._conn.execute(
            "SELECT video_id, finishes, skips FROM rando_stats"
        ):
            finishes = min(TASTE_CAP, row["finishes"] or 0)
            skips = min(TASTE_CAP, row["skips"] or 0)
            if not finishes and not skips:
                continue
            score = (finishes - skips) / float(TASTE_CAP)   # -1 .. 1
            taste[row["video_id"]] = max(0.15, 1.0 + TASTE_WEIGHT * score)
        return taste

    def finished(self, video_id, artist="", title="", played_seconds=0.0):
        """The song played all the way through — the only positive signal we take."""
        self._record(video_id, artist, title, finishes=1, played_seconds=played_seconds)

    def reset(self):
        self._mood.clear()
        self._recent.clear()

    # ---------- the pick ----------

    def next_track(self):
        tracks = self._candidates()
        if not tracks:
            return None, "no playable tracks in the library"

        fresh = [t for t in tracks if t["videoId"] not in self._recent]
        if not fresh:
            # Everything has played recently — forget the oldest half and retry.
            for _ in range(len(self._recent) // 2):
                self._recent.popleft()
            fresh = [t for t in tracks if t["videoId"] not in self._recent] or tracks

        wildcard = random.random() < WILDCARD_CHANCE
        if wildcard or not self._mood:
            # Genre-blind, but still leaning toward songs you have never heard.
            pick = random.choices(
                fresh, weights=[t["novelty"] * t["taste"] for t in fresh], k=1
            )[0]
        else:
            weights = [
                (self._score(t["genres"]) ** SHARPNESS + BASELINE_WEIGHT)
                * t["novelty"] * t["taste"]
                for t in fresh
            ]
            pick = random.choices(fresh, weights=weights, k=1)[0]

        self._recent.append(pick["videoId"])
        self._absorb(pick["genres"])
        self._record(pick["videoId"], pick["artist"], pick["title"], picks=1)
        pick["wildcard"] = wildcard
        pick["mood"] = [g for g, _ in self._mood.most_common(5)]
        return pick, ""
