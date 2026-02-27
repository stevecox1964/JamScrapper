import json
from datetime import datetime, timezone
from pathlib import Path


class HistoryStore:
    """Persistent play history log stored as a JSON array."""

    def __init__(self, data_dir=None, max_entries=1000):
        if data_dir is None:
            data_dir = Path(__file__).parent / "data"
        self.path = Path(data_dir) / "history.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.max_entries = max_entries
        self._history = self._load()

    def _load(self):
        if self.path.exists():
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self._history, f, indent=2, ensure_ascii=False)

    def add(self, artist, title, album="", source=""):
        entry = {
            "artist": artist,
            "title": title,
            "album": album,
            "source": source,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._history.append(entry)
        if len(self._history) > self.max_entries:
            self._history = self._history[-self.max_entries :]
        self._save()
        return entry

    def get_recent(self, limit=50):
        return list(reversed(self._history[-limit:]))
