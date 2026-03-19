"""One-time migration: read all JSON data files and insert into SQLite.

Usage:
    python migrate_json_to_sqlite.py

Safe to run multiple times — uses INSERT OR IGNORE / INSERT OR REPLACE.
Does NOT delete JSON files afterward (keep as backup).
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend is importable
sys.path.insert(0, str(Path(__file__).parent))

from db import get_db, init_db, json_dumps

DATA_DIR = Path(__file__).parent / "data"
MEDIA_DIR = DATA_DIR / "media_cache"
ARTISTS_DIR = DATA_DIR / "artists"


def load_json(path):
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  WARN: Could not load {path}: {e}")
        return None


def migrate_youtube_cache(conn):
    """Migrate youtube_cache.json → tracks table."""
    data = load_json(MEDIA_DIR / "youtube_cache.json")
    if not data:
        print("  youtube_cache.json: no data or missing")
        return 0
    count = 0
    now = datetime.now(timezone.utc).isoformat()
    for key, entry in data.items():
        video_id = entry.get("videoId")
        if not video_id:
            continue
        # Parse artist/title from the cache key "artist|||title"
        parts = key.split("|||", 1)
        artist = parts[0] if len(parts) > 0 else ""
        title = parts[1] if len(parts) > 1 else ""
        conn.execute("""
            INSERT OR IGNORE INTO tracks
                (artist, title, video_id, video_title, channel, duration, thumbnail_url, video_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            artist, title, video_id,
            entry.get("videoTitle", ""),
            entry.get("channel", ""),
            entry.get("duration", 0),
            entry.get("thumbnailUrl", ""),
            entry.get("videoUrl", ""),
            now,
        ))
        count += 1
    conn.commit()
    print(f"  youtube_cache.json: {count} tracks migrated")
    return count


def migrate_history(conn):
    """Migrate history.json → play_history table."""
    data = load_json(DATA_DIR / "history.json")
    if not data:
        print("  history.json: no data or missing")
        return 0
    count = 0
    for entry in data:
        artist = entry.get("artist", "")
        title = entry.get("title", "")
        # Try to link to a track
        row = conn.execute(
            "SELECT id FROM tracks WHERE artist = ? AND title = ? LIMIT 1",
            (artist.lower().strip(), title.lower().strip())
        ).fetchone()
        track_id = row["id"] if row else None

        conn.execute("""
            INSERT INTO play_history (artist, title, album, source, track_id, played_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            artist, title,
            entry.get("album", ""),
            entry.get("source", ""),
            track_id,
            entry.get("timestamp", datetime.now(timezone.utc).isoformat()),
        ))
        count += 1
    conn.commit()
    print(f"  history.json: {count} entries migrated")
    return count


def migrate_playlists(conn):
    """Migrate playlists.json → playlists + playlist_tracks tables."""
    data = load_json(DATA_DIR / "playlists.json")
    if not data:
        print("  playlists.json: no data or missing")
        return 0
    count = 0
    for pid, pl in data.items():
        conn.execute("""
            INSERT OR IGNORE INTO playlists (id, name, created_at)
            VALUES (?, ?, ?)
        """, (pid, pl.get("name", ""), pl.get("createdAt", "")))

        for i, track in enumerate(pl.get("tracks", [])):
            conn.execute("""
                INSERT INTO playlist_tracks
                    (playlist_id, video_id, artist, title, video_title, duration, position, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                pid,
                track.get("videoId", ""),
                track.get("artist", ""),
                track.get("title", ""),
                track.get("videoTitle", ""),
                track.get("duration", 0),
                i,
                track.get("addedAt", ""),
            ))
            count += 1
    conn.commit()
    print(f"  playlists.json: {len(data)} playlists, {count} tracks migrated")
    return count


def migrate_downloads(conn):
    """Migrate download_status.json → downloads table."""
    data = load_json(MEDIA_DIR / "download_status.json")
    if not data:
        print("  download_status.json: no data or missing")
        return 0
    count = 0
    for vid, status in data.items():
        conn.execute("""
            INSERT OR REPLACE INTO downloads
                (video_id, artist, title, video_title, state, progress,
                 file_size_mb, file_path, error, queued_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            status.get("videoId", vid),
            status.get("artist", ""),
            status.get("title", ""),
            status.get("videoTitle", ""),
            status.get("state", "queued"),
            status.get("progress", 0),
            status.get("fileSizeMB"),
            status.get("filePath", ""),
            status.get("error"),
            status.get("queuedAt"),
            status.get("completedAt"),
        ))
        count += 1
    conn.commit()
    print(f"  download_status.json: {count} downloads migrated")
    return count


def migrate_artists(conn):
    """Migrate backend/data/artists/*.json → artists table."""
    if not ARTISTS_DIR.exists():
        print("  artists/: directory missing")
        return 0
    count = 0
    for path in ARTISTS_DIR.glob("*.json"):
        data = load_json(path)
        if not data:
            continue
        slug = data.get("slug", path.stem)
        conn.execute("""
            INSERT OR REPLACE INTO artists
                (slug, name, images, dominant_colors, genres, mood_tags,
                 preferred_visualizer, songs, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            slug,
            data.get("name", ""),
            json_dumps(data.get("images", [])),
            json_dumps(data.get("dominantColors", [])),
            json_dumps(data.get("genres", [])),
            json_dumps(data.get("moodTags", [])),
            data.get("preferredVisualizer", ""),
            json_dumps(data.get("songs", [])),
            data.get("lastUpdated", ""),
        ))
        count += 1
    conn.commit()
    print(f"  artists/: {count} profiles migrated")
    return count


def migrate_choreography(conn):
    """Migrate choreography.json → choreography table."""
    data = load_json(DATA_DIR / "choreography.json")
    if not data:
        print("  choreography.json: no data or missing")
        return 0
    count = 0
    for key, entry in data.items():
        conn.execute("""
            INSERT OR REPLACE INTO choreography (id, data, saved_at)
            VALUES (?, ?, ?)
        """, (
            key,
            json_dumps(entry),
            entry.get("savedAt", ""),
        ))
        count += 1
    conn.commit()
    print(f"  choreography.json: {count} entries migrated")
    return count


def main():
    print("=== JSON to SQLite Migration ===")
    print(f"Database: {Path(__file__).parent / 'data' / 'visualaudio.db'}")
    print()

    conn = get_db()
    init_db(conn)

    print("Migrating...")
    migrate_youtube_cache(conn)
    migrate_history(conn)
    migrate_playlists(conn)
    migrate_downloads(conn)
    migrate_artists(conn)
    migrate_choreography(conn)

    # Summary
    print()
    print("=== Summary ===")
    for table in ["tracks", "play_history", "playlists", "playlist_tracks",
                   "downloads", "artists", "choreography"]:
        row = conn.execute(f"SELECT COUNT(*) as c FROM {table}").fetchone()
        print(f"  {table}: {row['c']} rows")

    conn.close()
    print()
    print("Done! JSON files preserved as backup.")


if __name__ == "__main__":
    main()
