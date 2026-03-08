import json
import re
from datetime import datetime, timezone
from pathlib import Path


class PlaylistStore:
    """Persistent playlist management stored as JSON."""

    def __init__(self, data_dir=None):
        if data_dir is None:
            data_dir = Path(__file__).parent / "data"
        self.path = Path(data_dir) / "playlists.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._playlists = self._load()

    def _load(self):
        if self.path.exists():
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self._playlists, f, indent=2, ensure_ascii=False)

    @staticmethod
    def _slugify(name):
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
        return slug or "playlist"

    def list_playlists(self):
        result = []
        for pid, pl in self._playlists.items():
            result.append({
                "id": pid,
                "name": pl["name"],
                "trackCount": len(pl.get("tracks", [])),
                "createdAt": pl.get("createdAt", ""),
            })
        result.sort(key=lambda x: x["createdAt"], reverse=True)
        return result

    def get_playlist(self, playlist_id):
        return self._playlists.get(playlist_id)

    def create_playlist(self, name):
        base_slug = self._slugify(name)
        slug = base_slug
        counter = 1
        while slug in self._playlists:
            counter += 1
            slug = f"{base_slug}-{counter}"

        self._playlists[slug] = {
            "id": slug,
            "name": name,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "tracks": [],
        }
        self._save()
        return self._playlists[slug]

    def delete_playlist(self, playlist_id):
        if playlist_id in self._playlists:
            del self._playlists[playlist_id]
            self._save()
            return True
        return False

    def add_track(self, playlist_id, track_info):
        pl = self._playlists.get(playlist_id)
        if not pl:
            return None
        video_id = track_info.get("videoId", "")
        if not video_id:
            return None
        # Deduplicate by videoId
        if any(t["videoId"] == video_id for t in pl["tracks"]):
            return pl
        pl["tracks"].append({
            "videoId": video_id,
            "artist": track_info.get("artist", ""),
            "title": track_info.get("title", ""),
            "videoTitle": track_info.get("videoTitle", ""),
            "duration": track_info.get("duration", 0),
            "addedAt": datetime.now(timezone.utc).isoformat(),
        })
        self._save()
        return pl

    def remove_track(self, playlist_id, video_id):
        pl = self._playlists.get(playlist_id)
        if not pl:
            return None
        pl["tracks"] = [t for t in pl["tracks"] if t["videoId"] != video_id]
        self._save()
        return pl

    def reorder_tracks(self, playlist_id, video_ids):
        pl = self._playlists.get(playlist_id)
        if not pl:
            return None
        by_id = {t["videoId"]: t for t in pl["tracks"]}
        reordered = [by_id[vid] for vid in video_ids if vid in by_id]
        # Append any tracks not in the reorder list
        seen = set(video_ids)
        for t in pl["tracks"]:
            if t["videoId"] not in seen:
                reordered.append(t)
        pl["tracks"] = reordered
        self._save()
        return pl
