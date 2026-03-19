import re
from datetime import datetime, timezone


class PlaylistStore:
    """Persistent playlist management stored in SQLite."""

    def __init__(self, conn):
        self._conn = conn

    @staticmethod
    def _slugify(name):
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
        return slug or "playlist"

    def list_playlists(self):
        rows = self._conn.execute("""
            SELECT p.id, p.name, p.created_at as createdAt, COUNT(pt.id) as trackCount
            FROM playlists p
            LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
            GROUP BY p.id
            ORDER BY p.created_at DESC
        """).fetchall()
        return [dict(r) for r in rows]

    def get_playlist(self, playlist_id):
        row = self._conn.execute(
            "SELECT id, name, created_at as createdAt FROM playlists WHERE id = ?",
            (playlist_id,)
        ).fetchone()
        if not row:
            return None
        pl = dict(row)
        tracks = self._conn.execute("""
            SELECT video_id as videoId, artist, title, video_title as videoTitle,
                   duration, added_at as addedAt
            FROM playlist_tracks
            WHERE playlist_id = ?
            ORDER BY position
        """, (playlist_id,)).fetchall()
        pl["tracks"] = [dict(t) for t in tracks]
        return pl

    def create_playlist(self, name):
        base_slug = self._slugify(name)
        slug = base_slug
        counter = 1
        while self._conn.execute("SELECT 1 FROM playlists WHERE id = ?", (slug,)).fetchone():
            counter += 1
            slug = f"{base_slug}-{counter}"

        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            "INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)",
            (slug, name, now),
        )
        self._conn.commit()
        return {"id": slug, "name": name, "createdAt": now, "tracks": []}

    def delete_playlist(self, playlist_id):
        row = self._conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not row:
            return False
        self._conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        self._conn.commit()
        return True

    def add_track(self, playlist_id, track_info):
        row = self._conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not row:
            return None
        video_id = track_info.get("videoId", "")
        if not video_id:
            return None
        # Deduplicate
        exists = self._conn.execute(
            "SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?",
            (playlist_id, video_id)
        ).fetchone()
        if exists:
            return self.get_playlist(playlist_id)

        # Get next position
        max_pos = self._conn.execute(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?",
            (playlist_id,)
        ).fetchone()[0]

        self._conn.execute("""
            INSERT INTO playlist_tracks (playlist_id, video_id, artist, title, video_title, duration, position, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            playlist_id, video_id,
            track_info.get("artist", ""),
            track_info.get("title", ""),
            track_info.get("videoTitle", ""),
            track_info.get("duration", 0),
            max_pos + 1,
            datetime.now(timezone.utc).isoformat(),
        ))
        self._conn.commit()
        return self.get_playlist(playlist_id)

    def remove_track(self, playlist_id, video_id):
        row = self._conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not row:
            return None
        self._conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?",
            (playlist_id, video_id),
        )
        self._conn.commit()
        return self.get_playlist(playlist_id)

    def reorder_tracks(self, playlist_id, video_ids):
        row = self._conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not row:
            return None
        # Get all current tracks
        existing = self._conn.execute(
            "SELECT video_id FROM playlist_tracks WHERE playlist_id = ?",
            (playlist_id,)
        ).fetchall()
        existing_ids = {r["video_id"] for r in existing}

        # Reorder: given IDs first, then any remaining
        ordered = list(video_ids) + [vid for vid in existing_ids if vid not in set(video_ids)]
        for i, vid in enumerate(ordered):
            self._conn.execute(
                "UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND video_id = ?",
                (i, playlist_id, vid),
            )
        self._conn.commit()
        return self.get_playlist(playlist_id)
