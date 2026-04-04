import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import requests


class MediaCache:
    """YouTube video search and thumbnail caching via yt-dlp, backed by SQLite."""

    def __init__(self, conn, data_dir=None):
        self._conn = conn
        if data_dir is None:
            data_dir = Path(__file__).parent / "data" / "media_cache"
        self.data_dir = Path(data_dir)
        self.thumb_dir = self.data_dir / "thumbnails"
        self.thumb_dir.mkdir(parents=True, exist_ok=True)
        self._yt_dlp_available = shutil.which("yt-dlp") is not None
        if not self._yt_dlp_available:
            print("yt-dlp not found -- YouTube search disabled")

    @staticmethod
    def _cache_key(artist, title):
        return f"{artist.lower().strip()}|||{title.lower().strip()}"

    def get_cached(self, artist, title):
        row = self._conn.execute(
            "SELECT video_id, video_title, channel, duration, thumbnail_url, video_url FROM tracks WHERE artist = ? AND title = ?",
            (artist.lower().strip(), title.lower().strip())
        ).fetchone()
        if not row:
            return None
        return {
            "videoId": row["video_id"],
            "videoTitle": row["video_title"],
            "channel": row["channel"],
            "duration": row["duration"],
            "thumbnailUrl": row["thumbnail_url"],
            "videoUrl": row["video_url"],
            "localThumbnail": f"thumbnails/{row['video_id']}.jpg",
        }

    def search_youtube(self, artist, title):
        """Search YouTube via yt-dlp with aggressive fallback queries.
        BLOCKING -- call via asyncio.to_thread().
        Returns dict with video metadata or None."""
        # Check SQLite cache first
        cached = self.get_cached(artist, title)
        if cached:
            return cached

        if not self._yt_dlp_available:
            return None

        # Build a list of increasingly broad queries so we find SOMETHING
        queries = []
        if artist and title:
            queries.append(f"{artist} {title} official music video")
            queries.append(f"{artist} {title} music video")
            queries.append(f"{artist} {title}")
        if artist:
            queries.append(f"{artist} official music video")
        if title and not artist:
            queries.append(f"{title} official music video")
            queries.append(f"{title}")

        for i, q in enumerate(queries):
            entry = self._yt_dlp_search(q, artist, title, attempt=i + 1, total=len(queries))
            if entry:
                return entry

        print(f"  [YT] All {len(queries)} queries failed for: {artist} - {title}")
        return None

    def _yt_dlp_search(self, query, artist, title, attempt=1, total=1):
        """Run a single yt-dlp search. Returns entry dict or None."""
        full_query = f"ytsearch1:{query}"
        try:
            print(f"  [YT] Search ({attempt}/{total}): {query}")
            result = subprocess.run(
                ["yt-dlp", "--dump-json", "--no-download", full_query],
                capture_output=True,
                text=True,
                timeout=20,
            )
            if result.returncode != 0:
                return None

            data = json.loads(result.stdout)
            video_id = data.get("id", "")
            if not video_id:
                return None

            entry = {
                "videoId": video_id,
                "videoTitle": data.get("title", ""),
                "channel": data.get("channel", ""),
                "duration": data.get("duration", 0),
                "thumbnailUrl": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "videoUrl": f"https://www.youtube.com/watch?v={video_id}",
            }

            self._download_thumbnail(video_id, entry["thumbnailUrl"])
            entry["localThumbnail"] = f"thumbnails/{video_id}.jpg"

            # Save to SQLite — use REPLACE keyed on (artist, title) so the
            # same track always points to one video_id.  Delete any stale row
            # for this artist+title first (there's no UNIQUE on that pair).
            a_key = artist.lower().strip()
            t_key = title.lower().strip()
            now = datetime.now(timezone.utc).isoformat()
            self._conn.execute(
                "DELETE FROM tracks WHERE artist = ? AND title = ?",
                (a_key, t_key),
            )
            self._conn.execute("""
                INSERT OR IGNORE INTO tracks
                    (artist, title, video_id, video_title, channel, duration, thumbnail_url, video_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                a_key, t_key, video_id,
                entry["videoTitle"], entry["channel"], entry["duration"],
                entry["thumbnailUrl"], entry["videoUrl"], now,
            ))
            self._conn.commit()
            print(f"  [YT] Cached: {entry['videoTitle']}")
            return entry

        except subprocess.TimeoutExpired:
            print(f"  [YT] Timeout ({attempt}/{total}): {query}")
            return None
        except Exception as e:
            print(f"  [YT] Error ({attempt}/{total}): {e}")
            return None

    def _download_thumbnail(self, video_id, url):
        dest = self.thumb_dir / f"{video_id}.jpg"
        if dest.exists():
            return
        try:
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
        except Exception as e:
            print(f"  [YT] Thumbnail download error: {e}")

    def get_all_cached(self):
        """Return all cached tracks for the library endpoint."""
        rows = self._conn.execute(
            "SELECT video_id, artist, title, video_title, channel, duration FROM tracks ORDER BY created_at DESC"
        ).fetchall()
        return [
            {
                "videoId": row["video_id"],
                "artist": row["artist"],
                "title": row["title"],
                "videoTitle": row["video_title"],
                "duration": row["duration"],
            }
            for row in rows
        ]

    def get_thumbnail_path(self, video_id):
        path = self.thumb_dir / f"{video_id}.jpg"
        return path if path.exists() else None
