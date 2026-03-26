"""Persists player mode state (queue, position, playback) to SQLite."""

import json
from datetime import datetime, timezone


class PlayerStateStore:
    STATE_KEY = "main"

    def __init__(self, conn):
        self._conn = conn
        self._ensure_table()

    def _ensure_table(self):
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS player_state (
                key         TEXT PRIMARY KEY,
                queue       TEXT NOT NULL DEFAULT '[]',
                queue_index INTEGER NOT NULL DEFAULT 0,
                current_time REAL NOT NULL DEFAULT 0,
                volume      REAL NOT NULL DEFAULT 1,
                playing     INTEGER NOT NULL DEFAULT 0,
                updated_at  TEXT NOT NULL
            )
        """)
        self._conn.commit()

    def save(self, queue, queue_index, current_time=0, volume=1, playing=False):
        ts = datetime.now(timezone.utc).isoformat()
        self._conn.execute("""
            INSERT OR REPLACE INTO player_state
                (key, queue, queue_index, current_time, volume, playing, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            self.STATE_KEY,
            json.dumps(queue, ensure_ascii=False),
            queue_index,
            current_time,
            volume,
            1 if playing else 0,
            ts,
        ))
        self._conn.commit()

    def load(self):
        row = self._conn.execute(
            "SELECT * FROM player_state WHERE key = ?", (self.STATE_KEY,)
        ).fetchone()
        if not row:
            return None
        return {
            "queue": json.loads(row["queue"]),
            "queueIndex": row["queue_index"],
            "currentTime": row["current_time"],
            "volume": row["volume"],
            "playing": bool(row["playing"]),
            "updatedAt": row["updated_at"],
        }

    def clear(self):
        self._conn.execute(
            "DELETE FROM player_state WHERE key = ?", (self.STATE_KEY,)
        )
        self._conn.commit()
