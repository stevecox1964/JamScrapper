import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


class VideoDownloader:
    """Download YouTube videos as MP4 via yt-dlp with progress tracking, backed by SQLite."""

    def __init__(self, conn, data_dir=None):
        self._conn = conn
        if data_dir is None:
            data_dir = Path(__file__).parent / "data" / "media_cache"
        self.data_dir = Path(data_dir)
        self.video_dir = self.data_dir / "videos"
        self.video_dir.mkdir(parents=True, exist_ok=True)
        self._yt_dlp_available = shutil.which("yt-dlp") is not None

    def is_downloaded(self, video_id):
        return (self.video_dir / f"{video_id}.mp4").exists()

    def get_status(self, video_id):
        row = self._conn.execute(
            "SELECT * FROM downloads WHERE video_id = ?", (video_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def get_all_status(self):
        rows = self._conn.execute(
            "SELECT * FROM downloads ORDER BY queued_at DESC"
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_storage_info(self):
        """Return total size of downloaded videos in MB and count."""
        total = 0
        count = 0
        for f in self.video_dir.glob("*.mp4"):
            total += f.stat().st_size
            count += 1
        return {"count": count, "totalMB": round(total / (1024 * 1024), 1)}

    @staticmethod
    def _row_to_dict(row):
        """Convert a sqlite3.Row to the camelCase dict the frontend expects."""
        if not row:
            return None
        return {
            "videoId": row["video_id"],
            "artist": row["artist"],
            "title": row["title"],
            "videoTitle": row["video_title"],
            "state": row["state"],
            "progress": row["progress"],
            "fileSizeMB": row["file_size_mb"],
            "filePath": row["file_path"],
            "error": row["error"],
            "queuedAt": row["queued_at"],
            "completedAt": row["completed_at"],
        }

    def _update_status(self, video_id, **kwargs):
        """Update specific fields in the downloads table."""
        sets = ", ".join(f"{k} = ?" for k in kwargs)
        vals = list(kwargs.values()) + [video_id]
        self._conn.execute(f"UPDATE downloads SET {sets} WHERE video_id = ?", vals)
        self._conn.commit()

    def download_video(self, video_id, artist, title, video_title):
        """Download a YouTube video as MP4. BLOCKING -- call via asyncio.to_thread().
        Returns the status record."""
        if self.is_downloaded(video_id):
            size_mb = round(
                (self.video_dir / f"{video_id}.mp4").stat().st_size / (1024 * 1024), 1
            )
            now = datetime.now(timezone.utc).isoformat()
            self._conn.execute("""
                INSERT OR REPLACE INTO downloads
                    (video_id, artist, title, video_title, state, progress,
                     file_size_mb, file_path, error, queued_at, completed_at)
                VALUES (?, ?, ?, ?, 'completed', 100, ?, ?, NULL, COALESCE(
                    (SELECT queued_at FROM downloads WHERE video_id = ?), ?), ?)
            """, (video_id, artist, title, video_title, size_mb,
                  f"videos/{video_id}.mp4", video_id, now, now))
            self._conn.commit()
            return self.get_status(video_id)

        if not self._yt_dlp_available:
            return None

        # Set initial queued status
        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute("""
            INSERT OR REPLACE INTO downloads
                (video_id, artist, title, video_title, state, progress,
                 file_size_mb, file_path, error, queued_at, completed_at)
            VALUES (?, ?, ?, ?, 'queued', 0, NULL, ?, NULL, ?, NULL)
        """, (video_id, artist, title, video_title, f"videos/{video_id}.mp4", now))
        self._conn.commit()

        output_path = self.video_dir / f"{video_id}.mp4"
        url = f"https://www.youtube.com/watch?v={video_id}"
        cmd = [
            "yt-dlp",
            "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
            "--merge-output-format", "mp4",
            "--no-playlist",
            "--newline",
            "--progress",
            "-o", str(output_path),
            url,
        ]

        try:
            self._update_status(video_id, state="downloading")

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )

            progress_re = re.compile(r"\[download\]\s+([\d.]+)%")
            frag_re = re.compile(r"\(frag\s+(\d+)/(\d+)\)")
            last_saved_pct = 0
            total_frags = 0
            is_audio_phase = False

            for line in proc.stdout:
                frag_m = frag_re.search(line)
                if frag_m:
                    frag_num = int(frag_m.group(1))
                    total_frags = int(frag_m.group(2))
                    if total_frags > 0:
                        if is_audio_phase:
                            pct = 80 + int(15 * frag_num / total_frags)
                        else:
                            pct = int(80 * frag_num / total_frags)
                        pct = min(pct, 99)
                        if pct - last_saved_pct >= 5:
                            self._update_status(video_id, progress=pct)
                            last_saved_pct = pct
                    continue

                if "Destination:" in line and total_frags > 0:
                    is_audio_phase = True
                    continue

                m = progress_re.search(line)
                if m and total_frags == 0:
                    pct = int(float(m.group(1)))
                    if pct - last_saved_pct >= 10:
                        self._update_status(video_id, progress=pct)
                        last_saved_pct = pct

            proc.wait(timeout=300)

            if proc.returncode == 0 and output_path.exists():
                size_mb = round(output_path.stat().st_size / (1024 * 1024), 1)
                self._update_status(
                    video_id,
                    state="completed", progress=100,
                    file_size_mb=size_mb,
                    completed_at=datetime.now(timezone.utc).isoformat(),
                )
                print(f"  [DL] Completed: {video_title} ({size_mb} MB)")
            else:
                self._update_status(
                    video_id,
                    state="failed",
                    error=f"yt-dlp exited with code {proc.returncode}",
                )

        except subprocess.TimeoutExpired:
            proc.kill()
            self._update_status(
                video_id, state="failed", error="Download timed out (300s)",
            )
        except Exception as e:
            self._update_status(video_id, state="failed", error=str(e))

        return self.get_status(video_id)

    def delete_video(self, video_id):
        """Remove a downloaded video file and its status."""
        path = self.video_dir / f"{video_id}.mp4"
        if path.exists():
            os.remove(path)
        self._conn.execute("DELETE FROM downloads WHERE video_id = ?", (video_id,))
        self._conn.commit()
