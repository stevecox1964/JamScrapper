"""Measured audio features for the songs we have on disk.

Rando steers on genre tags today, and tags are a poor proxy for how a song
sounds: the live data carries things like "british" and "spotify boycott",
and on 2026-08-23 the mood display showed "british" steering at 0.70 weight.
This module replaces that guess with numbers taken from the audio itself.

ffmpeg pulls a 60-second mono slice out of the middle of each saved mp4 and
librosa measures it. One row per video_id, computed once.

BLOCKING -- every public method here does file and CPU work. Call via
asyncio.to_thread() from the server.
"""

import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# Krumhansl-Schmuckler key profiles: how strongly each of the 12 pitch classes
# is expected to appear in a major or a minor key. Correlating a song's average
# chroma against all 24 rotations picks the key.
KRUMHANSL_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
KRUMHANSL_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

SAMPLE_RATE = 22050
SLICE_SECONDS = 60      # intros and outros skew every one of these numbers
MIN_SECONDS = 5.0       # anything shorter is not worth measuring


class SignatureAnalysisError(Exception):
    """This one file could not be measured. Never silently swallowed."""


class SignatureStore:
    def __init__(self, conn, videos_dir=None):
        self._conn = conn
        if videos_dir is None:
            videos_dir = Path(__file__).parent / "data" / "media_cache" / "videos"
        self.videos_dir = Path(videos_dir)

    # ---------- reads ----------

    def get(self, video_id):
        row = self._conn.execute(
            "SELECT * FROM signatures WHERE video_id = ?", (video_id,)
        ).fetchone()
        return dict(row) if row else None

    def has(self, video_id):
        return self._conn.execute(
            "SELECT 1 FROM signatures WHERE video_id = ?", (video_id,)
        ).fetchone() is not None

    def all_signatures(self):
        """video_id -> signature dict, for the picker to score against."""
        return {
            row["video_id"]: dict(row)
            for row in self._conn.execute("SELECT * FROM signatures")
        }

    def video_path(self, video_id):
        return self.videos_dir / f"{video_id}.mp4"

    def pending(self):
        """Every playable track that has a file on disk but no signature yet."""
        try:
            on_disk = {
                name[:-4]
                for name in os.listdir(self.videos_dir)
                if name.endswith(".mp4") and ".f" not in name[:-4]
            }
        except OSError:
            return []
        done = {
            row["video_id"]
            for row in self._conn.execute("SELECT video_id FROM signatures")
        }
        rows = self._conn.execute(
            "SELECT video_id, artist, title FROM tracks WHERE video_id != ''"
        ).fetchall()
        return [
            dict(r) for r in rows
            if r["video_id"] in on_disk and r["video_id"] not in done
        ]

    # ---------- the measurement ----------

    def _extract_audio(self, path, dest):
        """Pull a mono slice from the middle of the file. Raises on failure."""
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        try:
            duration = float((probe.stdout or "").strip())
        except ValueError:
            raise SignatureAnalysisError("ffprobe could not read a duration")
        if duration < MIN_SECONDS:
            raise SignatureAnalysisError(f"only {duration:.1f}s of audio")

        # Middle slice. Short tracks just start at zero.
        start = max(0.0, (duration / 2) - (SLICE_SECONDS / 2)) if duration > SLICE_SECONDS * 1.5 else 0.0
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(SLICE_SECONDS),
             "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-y", str(dest)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            raise SignatureAnalysisError(
                f"ffmpeg failed: {(result.stderr or '').strip()[:200]}"
            )

    @staticmethod
    def _estimate_key(chroma_mean):
        major = [
            np.corrcoef(np.roll(KRUMHANSL_MAJOR, i), chroma_mean)[0, 1]
            for i in range(12)
        ]
        minor = [
            np.corrcoef(np.roll(KRUMHANSL_MINOR, i), chroma_mean)[0, 1]
            for i in range(12)
        ]
        if max(major) >= max(minor):
            return NOTE_NAMES[int(np.argmax(major))], "major"
        return NOTE_NAMES[int(np.argmax(minor))], "minor"

    def analyse(self, video_id):
        """Measure one song. Returns the signature dict.

        Raises SignatureAnalysisError with a reason if it cannot -- callers are
        expected to record that reason, not skip quietly.
        """
        import librosa  # imported here so the server starts without it

        path = self.video_path(video_id)
        if not path.exists():
            raise SignatureAnalysisError("no video file on disk")

        handle, wav = tempfile.mkstemp(suffix=".wav")
        os.close(handle)
        try:
            self._extract_audio(path, wav)
            samples, rate = librosa.load(wav, sr=SAMPLE_RATE, mono=True)
            if samples.size < rate * MIN_SECONDS:
                raise SignatureAnalysisError("decoded audio was too short")

            rms = librosa.feature.rms(y=samples)[0]
            centroid = librosa.feature.spectral_centroid(y=samples, sr=rate)[0]
            chroma = librosa.feature.chroma_cqt(y=samples, sr=rate).mean(axis=1)
            key, mode = self._estimate_key(chroma)

            # BPM is stored but NOT trusted. On a ten-song sample it returned
            # exactly 152.0 for four unrelated tracks and called Mazzy Star's
            # slowest song 161. Treat it as a hint until it is validated
            # against songs whose real tempo is known -- do not weight the
            # picker on it.
            tempo = float(np.atleast_1d(
                librosa.beat.beat_track(y=samples, sr=rate)[0]
            )[0])

            return {
                "video_id": video_id,
                "bpm": round(tempo, 1),
                "energy": round(float(rms.mean()), 5),
                "dynamics": round(float(rms.std()), 5),
                "brightness": round(float(centroid.mean()), 1),
                "key": key,
                "mode": mode,
            }
        finally:
            try:
                os.unlink(wav)
            except OSError:
                pass

    def save(self, signature):
        self._conn.execute(
            "INSERT INTO signatures "
            "(video_id, bpm, energy, dynamics, brightness, key, mode, analysed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(video_id) DO UPDATE SET "
            "  bpm = excluded.bpm, energy = excluded.energy,"
            "  dynamics = excluded.dynamics, brightness = excluded.brightness,"
            "  key = excluded.key, mode = excluded.mode,"
            "  analysed_at = excluded.analysed_at",
            (
                signature["video_id"], signature["bpm"], signature["energy"],
                signature["dynamics"], signature["brightness"],
                signature["key"], signature["mode"],
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        self._conn.commit()

    def analyse_and_save(self, video_id):
        signature = self.analyse(video_id)
        self.save(signature)
        return signature
