import os
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

try:
    import acoustid
    ACOUSTID_AVAILABLE = True
except ImportError:
    ACOUSTID_AVAILABLE = False
    print("pyacoustid not installed — audio fingerprinting disabled")


def load_acoustid_key():
    """Load AcoustID API key from environment or .env file."""
    key = os.environ.get("ACOUSTID_API_KEY", "")
    if key:
        return key

    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == "ACOUSTID_API_KEY":
                return v.strip().strip("'\"")
    return ""


class AudioFingerprinter:
    """Buffers system audio and periodically identifies songs via AcoustID."""

    def __init__(self, api_key="", sample_rate=44100, buffer_seconds=20.0,
                 query_interval=12.0):
        self.api_key = api_key
        self.sample_rate = sample_rate
        self.buffer_size = int(sample_rate * buffer_seconds)
        self.query_interval = query_interval

        self._buffer = np.zeros(self.buffer_size, dtype=np.int16)
        self._buffer_pos = 0
        self._buffer_filled = False
        self._last_query_time = 0.0
        self._last_result = None

        self.enabled = bool(api_key) and ACOUSTID_AVAILABLE
        if not self.enabled and api_key and not ACOUSTID_AVAILABLE:
            print("AcoustID key found but pyacoustid not installed")

    def feed(self, mono_float):
        """Accept a chunk of mono float32 audio and append to circular buffer."""
        if not self.enabled:
            return

        int16_chunk = (mono_float * 32767).clip(-32768, 32767).astype(np.int16)
        chunk_len = len(int16_chunk)
        end_pos = self._buffer_pos + chunk_len

        if end_pos <= self.buffer_size:
            self._buffer[self._buffer_pos:end_pos] = int16_chunk
        else:
            first_part = self.buffer_size - self._buffer_pos
            self._buffer[self._buffer_pos:] = int16_chunk[:first_part]
            remaining = chunk_len - first_part
            self._buffer[:remaining] = int16_chunk[first_part:]
            self._buffer_filled = True

        self._buffer_pos = end_pos % self.buffer_size

    def can_query(self):
        """Check if enough audio is buffered and enough time has elapsed."""
        if not self.enabled:
            return False
        if time.time() - self._last_query_time < self.query_interval:
            return False
        min_samples = int(self.sample_rate * 10)
        filled = self.buffer_size if self._buffer_filled else self._buffer_pos
        return filled >= min_samples

    def _get_buffer_snapshot(self):
        """Get a contiguous copy of the buffered audio."""
        if self._buffer_filled:
            return np.concatenate([
                self._buffer[self._buffer_pos:],
                self._buffer[:self._buffer_pos],
            ])
        return self._buffer[:self._buffer_pos].copy()

    def identify(self):
        """Run fingerprint + AcoustID lookup. BLOCKING — call via asyncio.to_thread().

        Returns (artist, title, album, musicbrainz_id) or None.
        """
        if not self.enabled:
            return None

        self._last_query_time = time.time()
        audio_data = self._get_buffer_snapshot()

        if len(audio_data) < self.sample_rate * 3:
            return None

        tmp_path = None
        try:
            # Write buffer to temp WAV for acoustid.fingerprint_file()
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                tmp_path = f.name
                with wave.open(f, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(self.sample_rate)
                    wav.writeframes(audio_data.tobytes())

            duration, fingerprint = acoustid.fingerprint_file(tmp_path)

            results = acoustid.lookup(
                self.api_key, fingerprint, duration, meta="recordings"
            )

            for score, rec_id, title, artist in acoustid.parse_lookup_result(results):
                if score >= 0.5:
                    self._last_result = (artist or "", title or "", "", rec_id or "")
                    return self._last_result

            return None

        except Exception as e:
            print(f"Fingerprint error: {e}")
            return None
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    @property
    def last_result(self):
        return self._last_result

    def reset(self):
        """Clear the audio buffer (call on track change)."""
        self._buffer = np.zeros(self.buffer_size, dtype=np.int16)
        self._buffer_pos = 0
        self._buffer_filled = False
        self._last_result = None
