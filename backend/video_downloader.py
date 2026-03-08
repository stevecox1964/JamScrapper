import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


class VideoDownloader:
    """Download YouTube videos as MP4 via yt-dlp with progress tracking."""

    def __init__(self, data_dir=None):
        if data_dir is None:
            data_dir = Path(__file__).parent / "data" / "media_cache"
        self.data_dir = Path(data_dir)
        self.video_dir = self.data_dir / "videos"
        self.video_dir.mkdir(parents=True, exist_ok=True)
        self.status_path = self.data_dir / "download_status.json"
        self._status = self._load()
        self._yt_dlp_available = shutil.which("yt-dlp") is not None

    def _load(self):
        if self.status_path.exists():
            try:
                with open(self.status_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save(self):
        with open(self.status_path, "w", encoding="utf-8") as f:
            json.dump(self._status, f, indent=2, ensure_ascii=False)

    def is_downloaded(self, video_id):
        return (self.video_dir / f"{video_id}.mp4").exists()

    def get_status(self, video_id):
        return self._status.get(video_id)

    def get_all_status(self):
        items = list(self._status.values())
        items.sort(key=lambda x: x.get("queuedAt", ""), reverse=True)
        return items

    def get_storage_info(self):
        """Return total size of downloaded videos in MB and count."""
        total = 0
        count = 0
        for f in self.video_dir.glob("*.mp4"):
            total += f.stat().st_size
            count += 1
        return {"count": count, "totalMB": round(total / (1024 * 1024), 1)}

    def download_video(self, video_id, artist, title, video_title):
        """Download a YouTube video as MP4. BLOCKING -- call via asyncio.to_thread().
        Returns the status record."""
        if self.is_downloaded(video_id):
            size_mb = round(
                (self.video_dir / f"{video_id}.mp4").stat().st_size / (1024 * 1024), 1
            )
            self._status[video_id] = {
                "videoId": video_id,
                "artist": artist,
                "title": title,
                "videoTitle": video_title,
                "state": "completed",
                "progress": 100,
                "fileSizeMB": size_mb,
                "filePath": f"videos/{video_id}.mp4",
                "error": None,
                "queuedAt": self._status.get(video_id, {}).get(
                    "queuedAt", datetime.now(timezone.utc).isoformat()
                ),
                "completedAt": datetime.now(timezone.utc).isoformat(),
            }
            self._save()
            return self._status[video_id]

        if not self._yt_dlp_available:
            return None

        # Set initial queued status
        self._status[video_id] = {
            "videoId": video_id,
            "artist": artist,
            "title": title,
            "videoTitle": video_title,
            "state": "queued",
            "progress": 0,
            "fileSizeMB": None,
            "filePath": f"videos/{video_id}.mp4",
            "error": None,
            "queuedAt": datetime.now(timezone.utc).isoformat(),
            "completedAt": None,
        }
        self._save()

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
            self._status[video_id]["state"] = "downloading"
            self._save()

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
                # Track fragment progress (HLS downloads)
                frag_m = frag_re.search(line)
                if frag_m:
                    frag_num = int(frag_m.group(1))
                    total_frags = int(frag_m.group(2))
                    if total_frags > 0:
                        # Video = 0-80%, audio = 80-95%, merge = 95-100%
                        if is_audio_phase:
                            pct = 80 + int(15 * frag_num / total_frags)
                        else:
                            pct = int(80 * frag_num / total_frags)
                        self._status[video_id]["progress"] = min(pct, 99)
                        if pct - last_saved_pct >= 5:
                            self._save()
                            last_saved_pct = pct
                    continue

                # Detect audio phase start
                if "Destination:" in line and total_frags > 0:
                    is_audio_phase = True
                    continue

                # Direct download percentage (non-HLS)
                m = progress_re.search(line)
                if m and total_frags == 0:
                    pct = int(float(m.group(1)))
                    self._status[video_id]["progress"] = pct
                    if pct - last_saved_pct >= 10:
                        self._save()
                        last_saved_pct = pct

            proc.wait(timeout=300)

            if proc.returncode == 0 and output_path.exists():
                size_mb = round(output_path.stat().st_size / (1024 * 1024), 1)
                self._status[video_id].update({
                    "state": "completed",
                    "progress": 100,
                    "fileSizeMB": size_mb,
                    "completedAt": datetime.now(timezone.utc).isoformat(),
                })
                self._save()
                print(f"  [DL] Completed: {video_title} ({size_mb} MB)")
            else:
                self._status[video_id].update({
                    "state": "failed",
                    "error": f"yt-dlp exited with code {proc.returncode}",
                })
                self._save()

        except subprocess.TimeoutExpired:
            proc.kill()
            self._status[video_id].update({
                "state": "failed",
                "error": "Download timed out (300s)",
            })
            self._save()
        except Exception as e:
            self._status[video_id].update({
                "state": "failed",
                "error": str(e),
            })
            self._save()

        return self._status[video_id]

    def delete_video(self, video_id):
        """Remove a downloaded video file and its status."""
        path = self.video_dir / f"{video_id}.mp4"
        if path.exists():
            os.remove(path)
        if video_id in self._status:
            del self._status[video_id]
            self._save()
