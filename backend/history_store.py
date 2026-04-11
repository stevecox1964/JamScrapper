from datetime import datetime, timezone

from db import json_dumps, json_loads


class HistoryStore:
    """Persistent play history log stored in SQLite."""

    def __init__(self, conn, max_entries=1000):
        self._conn = conn
        self.max_entries = max_entries

    def add(self, artist, title, album="", source=""):
        ts = datetime.now(timezone.utc).isoformat()
        # Try to link to a track
        row = self._conn.execute(
            "SELECT id FROM tracks WHERE artist = ? AND title = ? LIMIT 1",
            (artist.lower().strip(), title.lower().strip())
        ).fetchone()
        track_id = row["id"] if row else None

        cur = self._conn.execute(
            "INSERT INTO play_history (artist, title, album, source, track_id, played_at) VALUES (?, ?, ?, ?, ?, ?)",
            (artist, title, album, source, track_id, ts),
        )
        history_id = cur.lastrowid
        # Trim to max_entries
        self._conn.execute("""
            DELETE FROM play_history WHERE id NOT IN (
                SELECT id FROM play_history ORDER BY played_at DESC LIMIT ?
            )
        """, (self.max_entries,))
        self._conn.commit()
        return history_id

    def update(self, history_id, *, genres=None, dominant_colors=None,
               artist_images=None, youtube_video_id=None, youtube_title=None,
               youtube_url=None, thumbnail_url=None, album=None):
        """Backfill enrichment data onto an existing play_history row."""
        if not history_id:
            return
        fields = []
        values = []
        if genres is not None:
            fields.append("genres = ?")
            values.append(json_dumps(genres))
        if dominant_colors is not None:
            fields.append("dominant_colors = ?")
            values.append(json_dumps(dominant_colors))
        if artist_images is not None:
            fields.append("artist_images = ?")
            values.append(json_dumps(artist_images))
        if youtube_video_id is not None:
            fields.append("youtube_video_id = ?")
            values.append(youtube_video_id)
        if youtube_title is not None:
            fields.append("youtube_title = ?")
            values.append(youtube_title)
        if youtube_url is not None:
            fields.append("youtube_url = ?")
            values.append(youtube_url)
        if thumbnail_url is not None:
            fields.append("thumbnail_url = ?")
            values.append(thumbnail_url)
        if album is not None:
            fields.append("album = ?")
            values.append(album)
        if not fields:
            return
        # Also re-link track_id in case YouTube cached it after initial insert
        values.append(history_id)
        self._conn.execute(
            f"UPDATE play_history SET {', '.join(fields)} WHERE id = ?",
            values,
        )
        self._conn.commit()

    def get_recent(self, limit=50):
        rows = self._conn.execute(
            """SELECT artist, title, album, source, played_at as timestamp,
                      genres, dominant_colors, artist_images,
                      youtube_video_id, youtube_title, youtube_url, thumbnail_url
               FROM play_history ORDER BY played_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["genres"] = json_loads(d.get("genres"))
            d["dominant_colors"] = json_loads(d.get("dominant_colors"))
            d["artist_images"] = json_loads(d.get("artist_images"))
            result.append(d)
        return result
