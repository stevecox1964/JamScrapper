import json
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests


MISS_TTL = timedelta(days=7)


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

    def get_recent_miss(self, artist, title):
        """Return True if we searched YouTube for this track within MISS_TTL and found nothing."""
        row = self._conn.execute(
            "SELECT searched_at FROM yt_search_misses WHERE artist = ? AND title = ?",
            (artist.lower().strip(), title.lower().strip())
        ).fetchone()
        if not row:
            return False
        try:
            searched_at = datetime.fromisoformat(row["searched_at"])
        except Exception:
            return False
        return datetime.now(timezone.utc) - searched_at < MISS_TTL

    def record_miss(self, artist, title):
        """Remember that a YouTube search for this track returned nothing."""
        a_key = artist.lower().strip()
        t_key = title.lower().strip()
        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute("""
            INSERT INTO yt_search_misses (artist, title, searched_at, attempts)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(artist, title) DO UPDATE SET
                searched_at = excluded.searched_at,
                attempts = attempts + 1
        """, (a_key, t_key, now))
        self._conn.commit()

    def clear_miss(self, artist, title):
        """Drop a miss record — called when we subsequently find a hit."""
        self._conn.execute(
            "DELETE FROM yt_search_misses WHERE artist = ? AND title = ?",
            (artist.lower().strip(), title.lower().strip())
        )
        self._conn.commit()

    def list_misses(self, limit=200):
        """Return recent YouTube search misses, newest first."""
        rows = self._conn.execute(
            "SELECT artist, title, searched_at, attempts FROM yt_search_misses "
            "ORDER BY searched_at DESC LIMIT ?",
            (int(limit),)
        ).fetchall()
        result = []
        for row in rows:
            searched_at = row["searched_at"]
            is_expired = True
            try:
                dt = datetime.fromisoformat(searched_at)
                is_expired = datetime.now(timezone.utc) - dt >= MISS_TTL
            except Exception:
                pass
            result.append({
                "artist": row["artist"],
                "title": row["title"],
                "searchedAt": searched_at,
                "attempts": row["attempts"],
                "expired": is_expired,
            })
        return result

    def clear_all_misses(self):
        """Delete every miss record. Returns count removed."""
        cur = self._conn.execute("DELETE FROM yt_search_misses")
        self._conn.commit()
        return cur.rowcount

    def remove_track(self, artist, title):
        """Delete a cached hit (e.g. the videoId turned out to be unplayable)
        and record a miss so future searches don't immediately return the same bad id.
        Returns the video_id that was purged, or ''."""
        a_key = artist.lower().strip()
        t_key = title.lower().strip()
        row = self._conn.execute(
            "SELECT video_id FROM tracks WHERE artist = ? AND title = ?",
            (a_key, t_key)
        ).fetchone()
        purged = row["video_id"] if row else ""
        self._conn.execute(
            "DELETE FROM tracks WHERE artist = ? AND title = ?",
            (a_key, t_key)
        )
        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute("""
            INSERT INTO yt_search_misses (artist, title, searched_at, attempts)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(artist, title) DO UPDATE SET
                searched_at = excluded.searched_at,
                attempts = attempts + 1
        """, (a_key, t_key, now))
        self._conn.commit()
        return purged

    def search_youtube(self, artist, title, skip_miss_cache=False):
        """Search YouTube via yt-dlp with aggressive fallback queries.
        BLOCKING -- call via asyncio.to_thread().
        Returns dict with video metadata or None.
        If a miss was recorded within MISS_TTL, returns None without running yt-dlp
        (pass skip_miss_cache=True to force a fresh search)."""
        # Check SQLite cache first
        cached = self.get_cached(artist, title)
        if cached:
            return cached

        if not skip_miss_cache and self.get_recent_miss(artist, title):
            print(f"  [YT] Skipping search — recent miss cached for: {artist} - {title}")
            return None

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
                self.clear_miss(artist, title)
                return entry

        print(f"  [YT] All {len(queries)} queries failed for: {artist} - {title}")
        self.record_miss(artist, title)
        return None

    @staticmethod
    def _score_result(data, artist_lower):
        """Score a yt-dlp result: higher = more likely to be a real music video.
        Penalizes auto-generated 'Topic' channels (static album art) and
        prefers VEVO / official channels with actual video content."""
        score = 0
        channel = (data.get("channel") or "").strip()
        ch_lower = channel.lower()
        title_lower = (data.get("title") or "").lower()
        view_count = data.get("view_count") or 0

        # Heavy penalty for Topic channels (auto-generated static image videos)
        if ch_lower.endswith("- topic") or ch_lower.endswith("topic"):
            score -= 50

        # Reward VEVO channels (almost always real music videos)
        if "vevo" in ch_lower:
            score += 40

        # Reward "official" in channel or title
        if "official" in ch_lower or "official" in title_lower:
            score += 20

        # Reward "music video" or "video" in title (indicates real video)
        if "music video" in title_lower:
            score += 25
        elif "video" in title_lower:
            score += 10

        # Penalize "audio" / "lyrics" / "lyric" in title (likely static)
        if "audio" in title_lower or "lyric" in title_lower:
            score -= 20

        # Penalize "full album" (don't want a 45-min album rip)
        if "full album" in title_lower:
            score -= 40

        # Modest bonus for views (popular = more likely official)
        if view_count > 10_000_000:
            score += 15
        elif view_count > 1_000_000:
            score += 10
        elif view_count > 100_000:
            score += 5

        # Reward if channel name contains the artist name
        if artist_lower and artist_lower in ch_lower:
            score += 15

        return score

    def _yt_dlp_search(self, query, artist, title, attempt=1, total=1):
        """Run yt-dlp search, fetch up to 5 results, and pick the best one.
        Prefers real music videos over auto-generated Topic/static videos."""
        full_query = f"ytsearch5:{query}"
        try:
            print(f"  [YT] Search ({attempt}/{total}): {query}")
            result = subprocess.run(
                ["yt-dlp", "--dump-single-json", "--no-download", full_query],
                capture_output=True,
                text=True,
                timeout=25,
            )
            if result.returncode != 0:
                return None

            wrapper = json.loads(result.stdout)
            entries = wrapper.get("entries") or []
            if not entries:
                return None

            # Score each result and pick the best
            artist_lower = (artist or "").lower().strip()
            scored = []
            for data in entries:
                vid = data.get("id", "")
                if not vid:
                    continue
                s = self._score_result(data, artist_lower)
                ch = (data.get("channel") or "")
                vt = (data.get("title") or "")
                print(f"    [{s:+d}] {ch}: {vt}")
                scored.append((s, data))

            if not scored:
                return None

            scored.sort(key=lambda x: x[0], reverse=True)
            best_data = scored[0][1]
            video_id = best_data.get("id", "")
            if not video_id:
                return None

            entry = {
                "videoId": video_id,
                "videoTitle": best_data.get("title", ""),
                "channel": best_data.get("channel", ""),
                "duration": best_data.get("duration", 0),
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
            print(f"  [YT] Cached (best of {len(scored)}): {entry['channel']}: {entry['videoTitle']}")
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

    def purge_topic_channels(self):
        """Delete cached entries from auto-generated Topic channels (static image videos).
        Called on startup so they get re-searched with the new scoring logic."""
        cur = self._conn.execute(
            "DELETE FROM tracks WHERE channel LIKE '% - Topic'"
        )
        count = cur.rowcount
        if count:
            self._conn.commit()
            print(f"  [YT] Purged {count} Topic channel entries — will re-search with real videos")
        return count

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
