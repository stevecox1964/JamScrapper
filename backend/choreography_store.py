import re
from datetime import datetime, timezone

from db import json_loads, json_dumps


class ChoreographyStore:
    """Persistent storage for image slideshow choreography in SQLite."""

    def __init__(self, conn):
        self._conn = conn

    @staticmethod
    def _make_key(artist, title):
        raw = f"{artist} - {title}".lower().strip()
        slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
        return slug or "unknown"

    def save_choreography(self, data):
        """Save a choreography entry. Overwrites previous for same track."""
        artist = data.get("track", {}).get("artist", "")
        title = data.get("track", {}).get("title", "")
        key = self._make_key(artist, title)
        now = datetime.now(timezone.utc).isoformat()
        entry = {**data, "id": key, "savedAt": now}
        self._conn.execute(
            "INSERT OR REPLACE INTO choreography (id, data, saved_at) VALUES (?, ?, ?)",
            (key, json_dumps(entry), now),
        )
        self._conn.commit()
        return entry

    def get_choreography(self, key):
        row = self._conn.execute(
            "SELECT data FROM choreography WHERE id = ?", (key,)
        ).fetchone()
        return json_loads(row["data"]) if row else None

    def list_choreographies(self):
        rows = self._conn.execute(
            "SELECT data, saved_at FROM choreography ORDER BY saved_at DESC"
        ).fetchall()
        result = []
        for row in rows:
            entry = json_loads(row["data"])
            result.append({
                "id": entry.get("id", ""),
                "artist": entry.get("track", {}).get("artist", ""),
                "title": entry.get("track", {}).get("title", ""),
                "imageCount": len(entry.get("images", [])),
                "eventCount": len(entry.get("events", [])),
                "savedAt": entry.get("savedAt", ""),
            })
        return result

    def delete_choreography(self, key):
        cursor = self._conn.execute("DELETE FROM choreography WHERE id = ?", (key,))
        self._conn.commit()
        return cursor.rowcount > 0
