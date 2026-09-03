"""Mood labels for the songs in the catalog, written by Claude.

The measured audio numbers in `signatures` turned out to be a weak mood
signal (2026-09-02: loudness ranked Mazzy Star above Rage Against the
Machine). Claude knows these songs. It reads artist, title and the artist's
genre tags and returns three 1-10 scores plus a few words from a fixed
vocabulary, so the picker can measure "same mood" as a distance.

One row per video_id, computed once. Needs ANTHROPIC_API_KEY (see env.py).

BLOCKING -- label_batch() makes a network call. Call via asyncio.to_thread()
from the server.
"""

import json
from datetime import datetime, timezone
from typing import List

from db import json_loads

MODEL = "claude-opus-5"
BATCH_SIZE = 20

# Fixed so that two songs sharing a word actually mean the same thing.
MOOD_WORDS = [
    "dark", "melancholy", "dreamy", "chill", "upbeat", "angry", "driving",
    "romantic", "anthemic", "gritty", "playful", "epic", "hypnotic", "raw",
    "tender", "brooding", "euphoric", "nostalgic", "sleazy", "spacey",
]

SYSTEM = f"""You label songs by how they feel to listen to, for a music player
that picks the next song to match the listener's current mood.

For each song return:
- energy: 1 (barely moving) to 10 (relentless).
- valence: 1 (bleak, sad, hopeless) to 10 (joyful, bright).
- tension: 1 (relaxed, resolved) to 10 (anxious, aggressive, unresolved).
- moods: 2 to 4 words chosen ONLY from this list: {", ".join(MOOD_WORDS)}.

Judge the specific recording, not the artist's reputation. A quiet song by a
loud band is quiet. If you do not know the song, judge from the title and
genres and set known to false. Return every song you were given, in order,
with its id unchanged."""


def _schema():
    """Built lazily so the server imports this module without pydantic."""
    from pydantic import BaseModel, Field

    class SongMood(BaseModel):
        id: str
        known: bool
        energy: int = Field(ge=1, le=10)
        valence: int = Field(ge=1, le=10)
        tension: int = Field(ge=1, le=10)
        moods: List[str]

    class MoodBatch(BaseModel):
        songs: List[SongMood]

    return MoodBatch


class MoodLabelError(Exception):
    """A batch could not be labelled. Never silently swallowed."""


class MoodStore:
    def __init__(self, conn):
        self._conn = conn

    # ---------- reads ----------

    def get(self, video_id):
        row = self._conn.execute(
            "SELECT * FROM moods WHERE video_id = ?", (video_id,)
        ).fetchone()
        return self._row(row) if row else None

    def all_moods(self):
        """video_id -> mood dict, for the picker to score against."""
        return {
            row["video_id"]: self._row(row)
            for row in self._conn.execute("SELECT * FROM moods")
        }

    @staticmethod
    def _row(row):
        d = dict(row)
        d["moods"] = json_loads(d["moods"]) or []
        return d

    def pending(self):
        """Every catalog track with a video but no mood label yet."""
        rows = self._conn.execute(
            "SELECT t.video_id, t.artist, t.title, COALESCE(a.genres, '[]') AS genres "
            "FROM tracks t "
            "LEFT JOIN artists a ON lower(a.name) = lower(t.artist) "
            "LEFT JOIN moods m ON m.video_id = t.video_id "
            "WHERE t.video_id != '' AND m.video_id IS NULL "
            "ORDER BY t.artist, t.title"
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["genres"] = (json_loads(d["genres"]) or [])[:6]
            out.append(d)
        return out

    # ---------- the labelling ----------

    def label_batch(self, tracks):
        """Ask Claude about up to BATCH_SIZE tracks. Returns a list of label
        dicts in the same order. Raises MoodLabelError on any failure."""
        import anthropic

        if not tracks:
            return []
        if len(tracks) > BATCH_SIZE:
            raise MoodLabelError(f"batch of {len(tracks)} exceeds {BATCH_SIZE}")

        listing = "\n".join(
            f"- id={t['video_id']} | {t['artist']} - {t['title']}"
            + (f" | genres: {', '.join(t['genres'])}" if t.get("genres") else "")
            for t in tracks
        )

        client = anthropic.Anthropic()
        try:
            response = client.messages.parse(
                model=MODEL,
                max_tokens=8000,
                system=SYSTEM,
                messages=[{"role": "user", "content": f"Label these songs:\n{listing}"}],
                output_format=_schema(),
                output_config={"effort": "low"},
            )
        except anthropic.AuthenticationError as e:
            raise MoodLabelError(f"bad or missing ANTHROPIC_API_KEY: {e}")
        except anthropic.APIError as e:
            raise MoodLabelError(f"Claude API error: {e}")

        if response.stop_reason == "refusal":
            raise MoodLabelError("Claude refused this batch")
        parsed = response.parsed_output
        if parsed is None:
            raise MoodLabelError("no parsed output in the response")

        by_id = {s.id: s for s in parsed.songs}
        missing = [t["video_id"] for t in tracks if t["video_id"] not in by_id]
        if missing:
            raise MoodLabelError(f"Claude skipped {len(missing)} songs: {missing}")

        labels = []
        for t in tracks:
            s = by_id[t["video_id"]]
            words = [w for w in s.moods if w in MOOD_WORDS]
            if not words:
                raise MoodLabelError(f"no valid mood words for {t['artist']} - {t['title']}: {s.moods}")
            labels.append({
                "video_id": t["video_id"],
                "known": s.known,
                "energy": s.energy,
                "valence": s.valence,
                "tension": s.tension,
                "moods": words,
            })
        return labels

    def save(self, label):
        self._conn.execute(
            "INSERT INTO moods (video_id, energy, valence, tension, moods, model, labelled_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(video_id) DO UPDATE SET "
            "  energy = excluded.energy, valence = excluded.valence,"
            "  tension = excluded.tension, moods = excluded.moods,"
            "  model = excluded.model, labelled_at = excluded.labelled_at",
            (
                label["video_id"], label["energy"], label["valence"], label["tension"],
                json.dumps(label["moods"]), MODEL,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        self._conn.commit()
