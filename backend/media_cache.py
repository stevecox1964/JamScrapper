import json
import shutil
import subprocess
from pathlib import Path

import requests


class MediaCache:
    """YouTube video search and thumbnail caching via yt-dlp."""

    def __init__(self, data_dir=None):
        if data_dir is None:
            data_dir = Path(__file__).parent / "data" / "media_cache"
        self.data_dir = Path(data_dir)
        self.thumb_dir = self.data_dir / "thumbnails"
        self.thumb_dir.mkdir(parents=True, exist_ok=True)
        self.cache_path = self.data_dir / "youtube_cache.json"
        self._cache = self._load()
        self._yt_dlp_available = shutil.which("yt-dlp") is not None
        if not self._yt_dlp_available:
            print("yt-dlp not found -- YouTube search disabled")

    def _load(self):
        if self.cache_path.exists():
            try:
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save(self):
        with open(self.cache_path, "w", encoding="utf-8") as f:
            json.dump(self._cache, f, indent=2, ensure_ascii=False)

    @staticmethod
    def _cache_key(artist, title):
        return f"{artist.lower().strip()}|||{title.lower().strip()}"

    def get_cached(self, artist, title):
        key = self._cache_key(artist, title)
        return self._cache.get(key)

    def search_youtube(self, artist, title):
        """Search YouTube via yt-dlp. BLOCKING -- call via asyncio.to_thread().
        Returns dict with video metadata or None."""
        key = self._cache_key(artist, title)
        if key in self._cache:
            return self._cache[key]

        if not self._yt_dlp_available:
            return None

        query = f"ytsearch1:{artist} {title} official music video"
        try:
            result = subprocess.run(
                ["yt-dlp", "--dump-json", "--no-download", query],
                capture_output=True,
                text=True,
                timeout=15,
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

            self._cache[key] = entry
            self._save()
            print(f"  [YT] Cached: {entry['videoTitle']}")
            return entry

        except subprocess.TimeoutExpired:
            print(f"  [YT] Timeout for: {artist} - {title}")
            return None
        except Exception as e:
            print(f"  [YT] Search error: {e}")
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

    def get_thumbnail_path(self, video_id):
        path = self.thumb_dir / f"{video_id}.jpg"
        return path if path.exists() else None
