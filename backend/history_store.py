from datetime import datetime, timezone

from db import json_dumps


class HistoryStore:
    """Persistent play history log stored in SQLite."""

    def __init__(self, conn, max_entries=1000):
        self._conn = conn
        self.max_entries = max_entries

    def add(self, artist, title, album="", source=""):
        ts = datetime.now(timezone.utc).isoformat()
        entry = {
            "artist": artist,
            "title": title,
            "album": album,
            "source": source,
            "timestamp": ts,
        }
        # Try to link to a track
        row = self._conn.execute(
            "SELECT id FROM tracks WHERE artist = ? AND title = ? LIMIT 1",
            (artist.lower().strip(), title.lower().strip())
        ).fetchone()
        track_id = row["id"] if row else None

        self._conn.execute(
            "INSERT INTO play_history (artist, title, album, source, track_id, played_at) VALUES (?, ?, ?, ?, ?, ?)",
            (artist, title, album, source, track_id, ts),
        )
        # Trim to max_entries
        self._conn.execute("""
            DELETE FROM play_history WHERE id NOT IN (
                SELECT id FROM play_history ORDER BY played_at DESC LIMIT ?
            )
        """, (self.max_entries,))
        self._conn.commit()
        return entry

    def get_recent(self, limit=50):
        rows = self._conn.execute(
            "SELECT artist, title, album, source, played_at as timestamp FROM play_history ORDER BY played_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
