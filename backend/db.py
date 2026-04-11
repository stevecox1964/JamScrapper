"""SQLite database layer — single file, WAL mode, thread-safe."""

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "visualaudio.db"


def get_db() -> sqlite3.Connection:
    """Return a connection with WAL mode and foreign keys enabled."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection):
    """Create all tables if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tracks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            artist      TEXT NOT NULL DEFAULT '',
            title       TEXT NOT NULL DEFAULT '',
            album       TEXT NOT NULL DEFAULT '',
            video_id    TEXT UNIQUE,
            video_title TEXT DEFAULT '',
            channel     TEXT DEFAULT '',
            duration    REAL DEFAULT 0,
            thumbnail_url TEXT DEFAULT '',
            video_url   TEXT DEFAULT '',
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS play_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            artist          TEXT NOT NULL DEFAULT '',
            title           TEXT NOT NULL DEFAULT '',
            album           TEXT NOT NULL DEFAULT '',
            source          TEXT NOT NULL DEFAULT '',
            track_id        INTEGER REFERENCES tracks(id),
            genres          TEXT DEFAULT '[]',
            dominant_colors TEXT DEFAULT '[]',
            artist_images   TEXT DEFAULT '[]',
            youtube_video_id TEXT DEFAULT '',
            youtube_title   TEXT DEFAULT '',
            youtube_url     TEXT DEFAULT '',
            thumbnail_url   TEXT DEFAULT '',
            played_at       TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            video_id    TEXT NOT NULL,
            artist      TEXT NOT NULL DEFAULT '',
            title       TEXT NOT NULL DEFAULT '',
            video_title TEXT DEFAULT '',
            duration    REAL DEFAULT 0,
            position    INTEGER NOT NULL DEFAULT 0,
            added_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS downloads (
            video_id     TEXT PRIMARY KEY,
            artist       TEXT NOT NULL DEFAULT '',
            title        TEXT NOT NULL DEFAULT '',
            video_title  TEXT DEFAULT '',
            state        TEXT NOT NULL DEFAULT 'queued',
            progress     INTEGER DEFAULT 0,
            file_size_mb REAL,
            file_path    TEXT DEFAULT '',
            error        TEXT,
            queued_at    TEXT,
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS artists (
            slug              TEXT PRIMARY KEY,
            name              TEXT NOT NULL,
            images            TEXT DEFAULT '[]',
            dominant_colors   TEXT DEFAULT '[]',
            genres            TEXT DEFAULT '[]',
            mood_tags         TEXT DEFAULT '[]',
            preferred_visualizer TEXT DEFAULT '',
            songs             TEXT DEFAULT '[]',
            last_updated      TEXT
        );

        CREATE TABLE IF NOT EXISTS choreography (
            id        TEXT PRIMARY KEY,
            data      TEXT NOT NULL,
            saved_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
        CREATE INDEX IF NOT EXISTS idx_downloads_state ON downloads(state);
        CREATE INDEX IF NOT EXISTS idx_tracks_artist_title ON tracks(artist, title);
    """)
    conn.commit()

    # Migrate existing play_history tables missing new columns
    existing = {row[1] for row in conn.execute("PRAGMA table_info(play_history)").fetchall()}
    new_columns = {
        "genres": "TEXT DEFAULT '[]'",
        "dominant_colors": "TEXT DEFAULT '[]'",
        "artist_images": "TEXT DEFAULT '[]'",
        "youtube_video_id": "TEXT DEFAULT ''",
        "youtube_title": "TEXT DEFAULT ''",
        "youtube_url": "TEXT DEFAULT ''",
        "thumbnail_url": "TEXT DEFAULT ''",
    }
    for col, col_type in new_columns.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE play_history ADD COLUMN {col} {col_type}")
    conn.commit()


# --- JSON helpers for list/dict columns ---

def json_loads(val):
    """Safely parse a JSON string, returning [] on failure."""
    if not val:
        return []
    try:
        return json.loads(val)
    except Exception:
        return []


def json_dumps(val):
    """Serialize a value to compact JSON."""
    return json.dumps(val, ensure_ascii=False)
