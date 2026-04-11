import asyncio
import base64
import ctypes
import ctypes.wintypes
import io
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import threading
import numpy as np
import requests
import soundcard as sc
from websockets.asyncio.server import serve, broadcast
from winrt.windows.media.control import (
    GlobalSystemMediaTransportControlsSessionManager as MediaManager,
)
from winrt.windows.storage.streams import Buffer, InputStreamOptions

import mimetypes
import sys

from db import get_db, init_db
from fingerprinter import AudioFingerprinter, load_acoustid_key
from artist_store import ArtistStore, enrich_artist_profile, fetch_album_from_musicbrainz
from history_store import HistoryStore
from media_cache import MediaCache
from playlist_store import PlaylistStore
from choreography_store import ChoreographyStore
from player_state_store import PlayerStateStore

SAMPLE_RATE = 44100
BLOCK_SIZE = 2048
FFT_BINS = 128
WAVEFORM_POINTS = 128
FPS = 30
MEDIA_POLL_INTERVAL = 1.0
EXTENSION_POLL_INTERVAL = 0.05

# Resolve frontend static files directory.
# PyInstaller bundles into sys._MEIPASS; otherwise look for ../frontend/dist
if getattr(sys, '_MEIPASS', None):
    FRONTEND_DIR = Path(sys._MEIPASS) / "frontend_dist"
else:
    FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"


def log_bin(fft_data, num_bins):
    """Group FFT bins into num_bins buckets using logarithmic spacing."""
    n = len(fft_data)
    if n == 0:
        return np.zeros(num_bins)

    edges = np.logspace(np.log10(1), np.log10(n), num_bins + 1).astype(int)
    edges = np.clip(edges, 0, n)
    edges = np.unique(edges)

    binned = np.zeros(len(edges) - 1)
    for i in range(len(edges) - 1):
        start, end = edges[i], edges[i + 1]
        if start < end:
            binned[i] = np.mean(fft_data[start:end])

    if len(binned) < num_bins:
        binned = np.pad(binned, (0, num_bins - len(binned)))
    elif len(binned) > num_bins:
        binned = binned[:num_bins]

    return binned


def downsample(data, target_len):
    """Downsample an array to target_len points."""
    if len(data) <= target_len:
        return data
    indices = np.linspace(0, len(data) - 1, target_len).astype(int)
    return data[indices]


# ---------- Media session & artist images ----------

media_info = {
    "artist": "",
    "title": "",
    "album": "",
    "albumArt": None,       # base64 data URI
    "artistImages": [],     # list of image URLs
    "dominantColors": [],
    "genres": [],
    "moodTags": [],
    "preferredVisualizer": "",
    "detectionSource": "",
    "_profileVersion": 0,
    "_historyVersion": 0,
    "youtubeVideoId": "",
    "youtubeTitle": "",
    "youtubeUrl": "",
    "youtubeThumbnailUrl": "",
    "youtubeDuration": 0,
}
_last_track_key = ""
_last_track_seen_at = 0.0
_profile_version = 0
_detection_source = ""
_image_cache = {}  # artist -> image list
_extension_seen_at = 0.0  # timestamp of last extension detection (for priority)
_enrichment_track_key = ""  # track key that current enrichment is for

# Source priority: higher = more trusted.  Extension reads DOM directly; WinRT
# may pick up the wrong Chrome session or a stale media session from another app.
SOURCE_PRIORITY = {"extension": 3, "chrome_tab": 2, "media_session": 1, "fingerprint": 0}
EXTENSION_PRIORITY_WINDOW = 5.0  # seconds to trust extension over lower sources

# Initialize SQLite database
_db_conn = get_db()
init_db(_db_conn)

# Artist profile storage, audio fingerprinter, history, and media cache
artist_store = ArtistStore(_db_conn)
fingerprinter = AudioFingerprinter(api_key=load_acoustid_key())
history_store = HistoryStore(_db_conn)
media_cache = MediaCache(_db_conn)
playlist_store = PlaylistStore(_db_conn)
choreography_store = ChoreographyStore(_db_conn)
player_state_store = PlayerStateStore(_db_conn)


# Known streaming services and their tab title patterns
# Most use "Song - Artist - Service" or "Artist - Song - Service"
STREAMING_SUFFIXES = [
    " - Pandora", " | Pandora", " – Pandora", " — Pandora",
    " - YouTube Music", " - YouTube", " - SoundCloud",
    " - Spotify", " | Spotify", " - Tidal", " - Deezer",
    " - Amazon Music", " - Apple Music", " - Qobuz",
]

# Splitters: hyphen, en-dash, em-dash, pipe (Pandora/Chrome often use these)
TITLE_SPLITTERS = [" - ", " – ", " — ", " | ", " · "]


def _split_track_parts(text):
    """Split track string into at most 2 parts using common delimiters. Returns [part1, part2] or [part]."""
    text = (text or "").strip()
    if not text:
        return []
    for sep in TITLE_SPLITTERS:
        if sep in text:
            parts = [p.strip() for p in text.split(sep, 1)]
            if len(parts) >= 2 and parts[0] and parts[1]:
                return parts
    return [text] if text else []


def parse_tab_title(title, require_service=False):
    """Try to extract artist/title from a browser tab title (e.g. Pandora, YT Music).
    If require_service=True, only returns results if a known streaming suffix was found."""
    if not title:
        return "", ""

    # Strip known service suffixes (try longest first so " - YouTube Music" before " - YouTube")
    clean = title.strip()
    found_service = False
    for suffix in sorted(STREAMING_SUFFIXES, key=len, reverse=True):
        if clean.endswith(suffix):
            clean = clean[: -len(suffix)].strip()
            found_service = True
            break

    # When called from Chrome title scraper, only proceed if it's a known streaming tab
    if require_service and not found_service:
        return "", ""

    # If nothing was stripped, still try to parse in case title is "Song - Artist" with no suffix
    if not clean:
        return "", ""

    # Filter out non-song pages (navigation pages, settings, etc.)
    non_song = ["my collection", "stations", "browse", "search", "settings", "home", "library", "queue", "playlist"]
    if any(ns in clean.lower() for ns in non_song):
        return "", ""

    parts = _split_track_parts(clean)
    if len(parts) == 2:
        # Assume "Title - Artist" (most common); also accept "Artist - Title"
        return parts[1], parts[0]  # artist, title
    if len(parts) == 1:
        return "", parts[0]

    return "", ""


def get_chrome_window_titles():
    """Read all Chrome window titles using Windows API (no extra deps).
    Returns a list of window title strings."""
    titles = []
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    GetWindowTextW = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLengthW = ctypes.windll.user32.GetWindowTextLengthW
    IsWindowVisible = ctypes.windll.user32.IsWindowVisible
    GetClassNameW = ctypes.windll.user32.GetClassNameW

    def callback(hwnd, _):
        if not IsWindowVisible(hwnd):
            return True
        cls = ctypes.create_unicode_buffer(256)
        GetClassNameW(hwnd, cls, 256)
        if cls.value != "Chrome_WidgetWin_1":
            return True
        length = GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value.strip()
        if title and " - Google Chrome" in title:
            # Strip " - Google Chrome" suffix
            title = title.rsplit(" - Google Chrome", 1)[0].strip()
            titles.append(title)
        return True

    EnumWindows(EnumWindowsProc(callback), 0)
    return titles


def detect_from_chrome_titles():
    """Scan Chrome window titles for streaming service tracks.
    Only matches tabs from known streaming services.
    Returns (artist, title) or (None, None)."""
    titles = get_chrome_window_titles()
    for title in titles:
        artist, song = parse_tab_title(title, require_service=True)
        if artist or song:
            return artist, song
    return None, None


def _extract_from_props(props, best_artist, best_title):
    """Extract artist/title/album/thumb from session media properties. Returns (artist, title, album, thumb) or None."""
    if props is None:
        return None
    artist = (props.artist or "").strip()
    title = (props.title or "").strip()
    album = (props.album_title or "").strip()
    if not artist and not title:
        return None
    # Prefer native artist; else try parsing title as tab (e.g. "Song - Artist - YouTube Music")
    if artist:
        return artist, title, album, props
    parsed_artist, parsed_title = parse_tab_title(title)
    if parsed_artist or parsed_title:
        return parsed_artist, parsed_title, album, props
    return None


async def get_media_session_info():
    """Read current 'Now Playing' info from Windows media session."""
    global _poll_count
    verbose = _poll_count <= 3 or _poll_count % 10 == 0

    try:
        sessions = await MediaManager.request_async()
        best_artist = ""
        best_title = ""
        best_album = ""
        best_thumb = None
        best_props = None

        # Prefer the current (active) session — the one the user is most likely controlling
        current = sessions.get_current_session()
        if current is not None:
            app_id = current.source_app_user_model_id
            props = await current.try_get_media_properties_async()
            raw_artist = (props.artist or "").strip() if props else ""
            raw_title = (props.title or "").strip() if props else ""
            raw_album = (props.album_title or "").strip() if props else ""
            if verbose:
                print(f"  [WinRT] Current session: app='{app_id}' raw_artist='{raw_artist}' raw_title='{raw_title}' raw_album='{raw_album}'")
            out = _extract_from_props(props, best_artist, best_title)
            if out is not None:
                best_artist, best_title, best_album, best_props = out[0], out[1], out[2], out[3]
            elif verbose and (raw_artist or raw_title):
                print(f"  [WinRT] Filtered out (navigation page or unparseable)")

        # Fallback: iterate all sessions if current didn't yield metadata
        if not best_artist and not best_title:
            all_sessions = sessions.get_sessions()
            for i in range(all_sessions.size):
                session = all_sessions.get_at(i)
                app_id = session.source_app_user_model_id
                props = await session.try_get_media_properties_async()
                raw_artist = (props.artist or "").strip() if props else ""
                raw_title = (props.title or "").strip() if props else ""
                if verbose:
                    print(f"  [WinRT] Session[{i}]: app='{app_id}' raw_artist='{raw_artist}' raw_title='{raw_title}'")
                out = _extract_from_props(props, best_artist, best_title)
                if out is not None:
                    best_artist, best_title, best_album, best_props = out[0], out[1], out[2], out[3]
                    break

        if not best_artist and not best_title:
            return None, None, None, None

        # Read album art thumbnail from the session we chose
        if best_props and best_props.thumbnail:
            try:
                stream = await best_props.thumbnail.open_read_async()
                buf = Buffer(5 * 1024 * 1024)
                await stream.read_async(buf, buf.capacity, InputStreamOptions.READ_AHEAD)
                raw = bytes(bytearray(buf))
                stream.close()
                if raw:
                    best_thumb = "data:image/png;base64," + base64.b64encode(raw).decode()
            except Exception:
                pass

        return best_artist, best_title, best_album, best_thumb
    except Exception as e:
        print(f"Media session error: {e}")
        return None, None, None, None


def fetch_artist_images(artist_name):
    """Fetch artist images from TheAudioDB, fallback to Wikipedia."""
    if not artist_name:
        return []

    if artist_name in _image_cache:
        return _image_cache[artist_name]

    images = []

    # Try TheAudioDB first
    try:
        resp = requests.get(
            f"https://www.theaudiodb.com/api/v1/json/2/search.php?s={requests.utils.quote(artist_name)}",
            timeout=5,
        )
        data = resp.json()
        if data.get("artists"):
            a = data["artists"][0]
            for key in [
                "strArtistThumb", "strArtistFanart", "strArtistFanart2",
                "strArtistFanart3", "strArtistWideThumb", "strArtistBanner",
            ]:
                url = a.get(key)
                if url:
                    images.append(url)
    except Exception as e:
        print(f"TheAudioDB error: {e}")

    # Fallback to Wikipedia if no images
    if not images:
        try:
            resp = requests.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query", "format": "json",
                    "titles": artist_name, "prop": "pageimages",
                    "pithumbsize": 800,
                },
                headers={"User-Agent": "AudioVisualizer/1.0"},
                timeout=5,
            )
            data = resp.json()
            for page in data.get("query", {}).get("pages", {}).values():
                if "thumbnail" in page:
                    images.append(page["thumbnail"]["source"])
        except Exception as e:
            print(f"Wikipedia error: {e}")

    _image_cache[artist_name] = images
    return images


def _normalize_key(artist, title):
    """Normalize artist+title for dedup: lowercase, collapse whitespace."""
    a = " ".join((artist or "").lower().split())
    t = " ".join((title or "").lower().split())
    return f"{a}|||{t}"


async def _handle_track_detected(artist, title, album, thumb_b64, source):
    """Common handler for when a track is detected (from any source)."""
    global _last_track_key, _last_track_seen_at, media_info, _profile_version, _detection_source
    global _extension_seen_at, _enrichment_track_key

    track_key = _normalize_key(artist, title)
    now = asyncio.get_running_loop().time()

    if track_key == _last_track_key:
        _last_track_seen_at = now
        if source == "extension":
            _extension_seen_at = now
        # Same track — but update album if it just became available
        if album and not media_info.get("album"):
            media_info = {**media_info, "album": album}
            print(f"  >> Album updated: {album}")
        return  # Same track, skip

    # --- Source priority gate ---
    # If extension recently reported a track, don't let lower-priority sources override it.
    src_prio = SOURCE_PRIORITY.get(source, 0)
    cur_prio = SOURCE_PRIORITY.get(_detection_source, 0)
    if _last_track_key and src_prio < cur_prio:
        time_since_ext = now - _extension_seen_at
        if _detection_source == "extension" and time_since_ext < EXTENSION_PRIORITY_WINDOW:
            print(f"  [SKIP] {source} tried to override extension (last seen {time_since_ext:.1f}s ago): {artist} - {title}")
            return

    _last_track_key = track_key
    _last_track_seen_at = now
    _detection_source = source
    if source == "extension":
        _extension_seen_at = now
    _profile_version += 1
    _enrichment_track_key = track_key
    print(f"  >> Now playing: {artist} - {title} ({album}) [via {source}]")

    # Log to play history (returns row ID for enrichment backfill)
    _current_history_id = history_store.add(artist, title, album, source)

    # Reset fingerprinter on track change
    fingerprinter.reset()

    # Check for cached YouTube data
    cached_yt = media_cache.get_cached(artist, title)
    cached_vid = cached_yt.get("videoId", "") if cached_yt else ""

    # IMMEDIATE broadcast — no blocking, user sees track info instantly
    media_info = {
        "artist": artist,
        "title": title,
        "album": album,
        "albumArt": thumb_b64,
        "artistImages": [],
        "dominantColors": [],
        "genres": [],
        "moodTags": [],
        "preferredVisualizer": "",
        "detectionSource": source,
        "_profileVersion": _profile_version,
        "_historyVersion": media_info.get("_historyVersion", 0) + 1,
        "youtubeVideoId": cached_vid,
        "youtubeTitle": cached_yt.get("videoTitle", "") if cached_yt else "",
        "youtubeUrl": cached_yt.get("videoUrl", "") if cached_yt else "",
        "youtubeThumbnailUrl": f"/media/thumbnails/{cached_vid}.jpg" if cached_vid else "",
        "youtubeDuration": cached_yt.get("duration", 0) if cached_yt else 0,
    }

    # Fire off all enrichment as non-blocking background tasks
    asyncio.create_task(_enrich_track(artist, title, album, thumb_b64, _current_history_id))


async def _enrich_track(artist, title, album, thumb_b64, history_id=None):
    """Background enrichment: images, genres, colors, YouTube. Non-blocking.
    YouTube search runs in parallel with artist enrichment for instant video playback.
    Guards every update: if the user skipped to a new track, stop writing to media_info.
    Backfills enrichment data to play_history row via history_id."""
    global media_info, _profile_version

    my_key = _normalize_key(artist, title)

    def _stale():
        """Return True if a newer track has been detected — stop enriching."""
        return _enrichment_track_key != my_key

    # Kick off YouTube search immediately (don't wait for images/profile)
    yt_task = None
    if artist and title:
        yt_task = asyncio.create_task(_fetch_youtube_data(artist, title, history_id))

    # Artist images (runs in parallel with YouTube search)
    artist_imgs = []
    try:
        artist_imgs = await asyncio.to_thread(fetch_artist_images, artist)
        if _stale():
            print(f"  [STALE] Dropping image results for {artist} - {title}")
        else:
            _profile_version += 1
            media_info = {
                **media_info,
                "artistImages": artist_imgs,
                "albumArt": thumb_b64 or media_info.get("albumArt"),
                "_profileVersion": _profile_version,
            }
    except Exception as e:
        print(f"  Image fetch error: {e}")

    # Album lookup via MusicBrainz if not already known
    if not album and artist and title and not _stale():
        try:
            mb_album = await asyncio.to_thread(fetch_album_from_musicbrainz, artist, title)
            if mb_album and not _stale():
                album = mb_album
                _profile_version += 1
                media_info = {**media_info, "album": album, "_profileVersion": _profile_version}
                print(f"  Album (MusicBrainz): {album}")
        except Exception as e:
            print(f"  Album lookup error: {e}")

    # Profile enrichment (genres, colors, moods)
    if not _stale():
        try:
            profile = await enrich_artist_profile(
                artist_store, artist, artist_imgs
            )
            if title:
                await asyncio.to_thread(
                    artist_store.update_song, artist, title, album
                )
            if not _stale():
                _profile_version += 1
                media_info = {
                    **media_info,
                    "dominantColors": profile.get("dominantColors", []),
                    "genres": profile.get("genres", []),
                    "moodTags": profile.get("moodTags", []),
                    "preferredVisualizer": profile.get("preferredVisualizer", ""),
                    "_profileVersion": _profile_version,
                }
                print(f"  Genres: {profile.get('genres', [])}")
                print(f"  Colors: {len(profile.get('dominantColors', []))} extracted")
                print(f"  Images: {len(artist_imgs)} found")
            else:
                print(f"  [STALE] Dropping profile results for {artist} - {title}")
        except Exception as e:
            print(f"  Profile enrichment error: {e}")

    if yt_task:
        await yt_task

    # Backfill all enrichment data to play_history
    if history_id and not _stale():
        try:
            yt_vid = media_info.get("youtubeVideoId", "")
            history_store.update(
                history_id,
                genres=media_info.get("genres", []),
                dominant_colors=media_info.get("dominantColors", []),
                artist_images=media_info.get("artistImages", []),
                youtube_video_id=yt_vid,
                youtube_title=media_info.get("youtubeTitle", ""),
                youtube_url=media_info.get("youtubeUrl", ""),
                thumbnail_url=media_info.get("youtubeThumbnailUrl", ""),
                album=media_info.get("album", "") or album,
            )
        except Exception as e:
            print(f"  History backfill error: {e}")


async def _fetch_youtube_data(artist, title, history_id=None, max_retries=2):
    """Search YouTube and update media_info with video metadata.
    Retries on failure with a delay — aggressively tries to find a video."""
    global media_info, _profile_version
    my_key = _normalize_key(artist, title)

    for attempt in range(1, max_retries + 1):
        if _enrichment_track_key != my_key:
            print(f"  [STALE] Aborting YouTube search for {artist} - {title}")
            return
        try:
            result = await asyncio.to_thread(media_cache.search_youtube, artist, title)
            if result and _enrichment_track_key == my_key:
                video_id = result.get("videoId", "")
                _profile_version += 1
                media_info = {
                    **media_info,
                    "youtubeVideoId": video_id,
                    "youtubeTitle": result.get("videoTitle", ""),
                    "youtubeUrl": result.get("videoUrl", ""),
                    "youtubeThumbnailUrl": f"/media/thumbnails/{result['videoId']}.jpg",
                    "youtubeDuration": result.get("duration", 0),
                    "_profileVersion": _profile_version,
                }
                # Backfill YouTube data to history
                if history_id:
                    try:
                        history_store.update(
                            history_id,
                            youtube_video_id=video_id,
                            youtube_title=result.get("videoTitle", ""),
                            youtube_url=result.get("videoUrl", ""),
                            thumbnail_url=f"/media/thumbnails/{video_id}.jpg",
                        )
                    except Exception as e:
                        print(f"  YT history backfill error: {e}")
                print(f"  YouTube: {result.get('videoTitle', '')} ({video_id})")
                return  # Success
            elif result:
                print(f"  [STALE] Dropping YouTube results for {artist} - {title}")
                return
            # result is None — search failed, retry after delay
            if attempt < max_retries:
                print(f"  [YT] No result for {artist} - {title}, retrying in 5s (attempt {attempt}/{max_retries})")
                await asyncio.sleep(5)
        except Exception as e:
            print(f"  YouTube fetch error (attempt {attempt}): {e}")
            if attempt < max_retries:
                await asyncio.sleep(5)

    print(f"  [YT] Exhausted all {max_retries} attempts for: {artist} - {title}")


_poll_count = 0


async def media_poll_loop():
    """Poll Windows media session frequently for track changes.
    Falls back to scraping Chrome window titles if media session gives nothing useful."""
    global _poll_count

    while True:
        _poll_count += 1
        detected = False

        # --- Source 1: Windows Media Session API ---
        artist, title, album, thumb_b64 = await get_media_session_info()

        if _poll_count <= 3 or _poll_count % 10 == 0:
            print(f"[poll #{_poll_count}] Media session: artist='{artist}' title='{title}' album='{album}'")

        if artist is not None and (artist or title):
            await _handle_track_detected(artist, title, album, thumb_b64, "media_session")
            detected = True

        # --- Source 2: Chrome window title scraper (fallback) ---
        if not detected:
            chrome_artist, chrome_title = await asyncio.to_thread(detect_from_chrome_titles)
            if _poll_count <= 3 or _poll_count % 10 == 0:
                print(f"[poll #{_poll_count}] Chrome titles: artist='{chrome_artist}' title='{chrome_title}'")
            if chrome_artist or chrome_title:
                await _handle_track_detected(
                    chrome_artist or "", chrome_title or "", "", None, "chrome_tab"
                )

        await asyncio.sleep(MEDIA_POLL_INTERVAL)


# ---------- Audio capture ----------

connected_clients = set()
latest_frame = None
running_max = 1.0


async def audio_capture_loop():
    """Continuously capture system audio via WASAPI loopback and compute FFT."""
    global latest_frame, running_max

    speaker = sc.default_speaker()
    mic = sc.get_microphone(id=str(speaker.id), include_loopback=True)

    print(f"Capturing audio from: {speaker.name}")
    print(f"Sample rate: {SAMPLE_RATE}, Block size: {BLOCK_SIZE}")

    with mic.recorder(samplerate=SAMPLE_RATE, blocksize=BLOCK_SIZE) as rec:
        while True:
            data = await asyncio.to_thread(rec.record, BLOCK_SIZE)

            mono = data.mean(axis=1)
            fingerprinter.feed(mono)
            fft_raw = np.abs(np.fft.rfft(mono))
            fft_binned = log_bin(fft_raw, FFT_BINS)

            current_max = fft_binned.max()
            if current_max > running_max:
                running_max = current_max
            else:
                running_max = running_max * 0.995 + current_max * 0.005

            if running_max > 0:
                fft_normalized = (fft_binned / running_max).clip(0, 1)
            else:
                fft_normalized = np.zeros(FFT_BINS)

            waveform = downsample(mono, WAVEFORM_POINTS)
            peak = float(np.max(np.abs(mono)))

            latest_frame = json.dumps({
                "fft": np.round(fft_normalized, 4).tolist(),
                "waveform": np.round(waveform, 4).tolist(),
                "peak": round(peak, 4),
                "media": media_info,
            })

            await asyncio.sleep(1 / FPS)


async def handler(websocket):
    """Handle a new WebSocket client connection."""
    connected_clients.add(websocket)
    print(f"Client connected ({len(connected_clients)} total)")
    try:
        async for _ in websocket:
            pass
    finally:
        connected_clients.discard(websocket)
        print(f"Client disconnected ({len(connected_clients)} total)")


async def broadcast_loop():
    """Send the latest audio frame to all connected clients."""
    while True:
        if connected_clients:
            frame = latest_frame
            if not frame:
                frame = json.dumps({
                    "fft": [],
                    "waveform": [],
                    "peak": 0,
                    "media": media_info,
                })
            broadcast(connected_clients, frame)
        await asyncio.sleep(1 / FPS)


async def fingerprint_poll_loop():
    """Periodically attempt audio fingerprint identification as fallback."""
    global media_info, _last_track_key, _profile_version, _detection_source

    while True:
        await asyncio.sleep(3)

        # Only fingerprint if media session didn't identify the track
        if media_info.get("artist") and _detection_source == "media_session":
            continue

        if not fingerprinter.can_query():
            continue

        result = await asyncio.to_thread(fingerprinter.identify)
        if result is None:
            continue

        fp_artist, fp_title, fp_album, fp_mbid = result
        if not fp_artist and not fp_title:
            continue

        track_key = f"{fp_artist}|||{fp_title}"
        if track_key == _last_track_key:
            continue

        _last_track_key = track_key
        _detection_source = "fingerprint"
        _profile_version += 1
        print(f"Fingerprint identified: {fp_artist} - {fp_title}")

        fp_history_id = history_store.add(fp_artist, fp_title, fp_album, "fingerprint")

        artist_imgs = await asyncio.to_thread(fetch_artist_images, fp_artist)
        profile = await enrich_artist_profile(artist_store, fp_artist, artist_imgs)

        if fp_title:
            await asyncio.to_thread(
                artist_store.update_song, fp_artist, fp_title, fp_album, fp_mbid
            )

        _profile_version += 1
        media_info = {
            "artist": fp_artist,
            "title": fp_title,
            "album": fp_album,
            "albumArt": media_info.get("albumArt"),
            "artistImages": artist_imgs,
            "dominantColors": profile.get("dominantColors", []),
            "genres": profile.get("genres", []),
            "moodTags": profile.get("moodTags", []),
            "preferredVisualizer": profile.get("preferredVisualizer", ""),
            "detectionSource": "fingerprint",
            "_profileVersion": _profile_version,
            "_historyVersion": media_info.get("_historyVersion", 0) + 1,
            "youtubeVideoId": "",
            "youtubeTitle": "",
            "youtubeUrl": "",
            "youtubeThumbnailUrl": "",
            "youtubeDuration": 0,
        }

        # Backfill enrichment to history
        try:
            history_store.update(
                fp_history_id,
                genres=profile.get("genres", []),
                dominant_colors=profile.get("dominantColors", []),
                artist_images=artist_imgs,
            )
        except Exception as e:
            print(f"  Fingerprint history backfill error: {e}")

        if fp_artist and fp_title:
            asyncio.create_task(_fetch_youtube_data(fp_artist, fp_title, fp_history_id))


# ---------- HTTP server for Chrome extension ----------

_extension_track = None  # latest track from extension


class TrackHandler(BaseHTTPRequestHandler):

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        if self.path == "/history":
            self._json_response(history_store.get_recent(50))

        elif self.path == "/history/playable":
            enriched = []
            for entry in history_store.get_recent(100):
                artist = (entry.get("artist") or "").strip()
                title = (entry.get("title") or "").strip()
                cached = media_cache.get_cached(artist, title) if (artist or title) else None
                # Prefer cached YouTube data, fall back to stored history data
                video_id = (cached.get("videoId", "") if cached else "") or entry.get("youtube_video_id", "")
                enriched.append({
                    **entry,
                    "videoId": video_id,
                    "videoTitle": (cached.get("videoTitle", "") if cached else "") or entry.get("youtube_title", ""),
                    "duration": (cached.get("duration", 0) if cached else 0),
                    "isPlayable": bool(video_id),
                })
            self._json_response(enriched)

        elif self.path == "/now-playing":
            self._json_response({"media": media_info})

        elif self.path == "/library":
            tracks = media_cache.get_all_cached()
            self._json_response({"tracks": tracks})

        elif self.path == "/playlists":
            self._json_response(playlist_store.list_playlists())

        elif self.path.startswith("/playlists/"):
            playlist_id = self.path[len("/playlists/"):]
            pl = playlist_store.get_playlist(playlist_id)
            if pl:
                self._json_response(pl)
            else:
                self.send_response(404)
                self.end_headers()

        elif self.path == "/choreography":
            self._json_response(choreography_store.list_choreographies())

        elif self.path.startswith("/choreography/"):
            key = self.path[len("/choreography/"):]
            entry = choreography_store.get_choreography(key)
            if entry:
                self._json_response(entry)
            else:
                self.send_response(404)
                self.end_headers()

        elif self.path == "/player-state":
            state = player_state_store.load()
            self._json_response(state or {})

        elif self.path.startswith("/media/"):
            relative = self.path[len("/media/"):]
            file_path = Path(__file__).parent / "data" / "media_cache" / relative
            if file_path.exists() and file_path.is_file():
                ct = "image/jpeg" if file_path.suffix == ".jpg" else "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", ct)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(file_path.read_bytes())
            else:
                self.send_response(404)
                self.end_headers()
        else:
            self._serve_static()

    def _serve_static(self):
        """Serve built frontend files (SPA with index.html fallback)."""
        url_path = self.path.split("?")[0].split("#")[0]
        if url_path == "/":
            url_path = "/index.html"
        # Prevent path traversal
        safe = Path(url_path.lstrip("/"))
        if ".." in safe.parts:
            self.send_response(403)
            self.end_headers()
            return
        file_path = FRONTEND_DIR / safe
        if not file_path.is_file():
            # SPA fallback: serve index.html for client-side routes
            file_path = FRONTEND_DIR / "index.html"
        if file_path.is_file():
            ct = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
            data = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global _extension_track
        if self.path == "/track":
            body = self._read_body()
            artist = (body.get("artist") or "").strip()
            title = (body.get("title") or "").strip()
            album = (body.get("album") or "").strip()
            if artist or title:
                # Preserve album from prior send if this one is empty (DOM poll has no album)
                if not album and _extension_track and _extension_track.get("album"):
                    prev = _extension_track
                    if prev["artist"] == artist and prev["title"] == title:
                        album = prev["album"]
                _extension_track = {"artist": artist, "title": title, "album": album}
                print(f"  [EXT] Received: {artist} - {title}")
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

        elif self.path == "/choreography":
            body = self._read_body()
            action = body.get("action", "save")
            if action == "delete":
                key = body.get("id", "")
                choreography_store.delete_choreography(key)
                self._json_response({"ok": True})
            else:
                entry = choreography_store.save_choreography(body)
                self._json_response(entry)

        elif self.path == "/playlists":
            body = self._read_body()
            action = body.get("action", "create")
            if action == "create":
                name = body.get("name", "Untitled")
                pl = playlist_store.create_playlist(name)
                self._json_response(pl)
            else:
                self.send_response(400)
                self.end_headers()

        elif self.path.startswith("/playlists/"):
            playlist_id = self.path[len("/playlists/"):]
            body = self._read_body()
            action = body.get("action", "")
            if action == "add_track":
                pl = playlist_store.add_track(playlist_id, body)
                if pl:
                    self._json_response(pl)
                else:
                    self.send_response(404)
                    self.end_headers()
            elif action == "remove_track":
                pl = playlist_store.remove_track(playlist_id, body.get("videoId", ""))
                if pl:
                    self._json_response(pl)
                else:
                    self.send_response(404)
                    self.end_headers()
            elif action == "delete":
                playlist_store.delete_playlist(playlist_id)
                self._json_response({"ok": True})
            elif action == "reorder":
                pl = playlist_store.reorder_tracks(playlist_id, body.get("videoIds", []))
                if pl:
                    self._json_response(pl)
                else:
                    self.send_response(404)
                    self.end_headers()
            else:
                self.send_response(400)
                self.end_headers()

        elif self.path == "/player-state":
            body = self._read_body()
            player_state_store.save(
                queue=body.get("queue", []),
                queue_index=body.get("queueIndex", 0),
                current_time=body.get("currentTime", 0),
                volume=body.get("volume", 1),
                playing=body.get("playing", False),
            )
            self._json_response({"ok": True})

        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        pass  # silence request logs


def start_http_server():
    server = HTTPServer(("localhost", 8766), TrackHandler)
    server.serve_forever()


async def extension_poll_loop():
    """Check for track info from the Chrome extension."""
    global _extension_track
    while True:
        track = _extension_track
        if track:
            _extension_track = None
            await _handle_track_detected(
                track["artist"], track["title"], track["album"], None, "extension"
            )
        await asyncio.sleep(EXTENSION_POLL_INTERVAL)


async def main():
    print("Starting VisualAudioScraper...")
    print("Frontend: http://localhost:5173  (Vite)")
    print("WebSocket: ws://localhost:8765")
    if fingerprinter.enabled:
        print("Audio fingerprinting: enabled")
    else:
        print("Audio fingerprinting: disabled (no ACOUSTID_API_KEY)")

    # Start HTTP server in a background thread
    threading.Thread(target=start_http_server, daemon=True).start()

    async with serve(handler, "localhost", 8765):
        print("WebSocket ready — waiting for Vite...")
        import webbrowser, socket
        # Wait for Vite dev server to be listening before opening browser
        for _ in range(60):
            try:
                with socket.create_connection(("localhost", 5173), timeout=0.5):
                    break
            except OSError:
                await asyncio.sleep(0.5)
        print("Opening browser at http://localhost:5173")
        webbrowser.open("http://localhost:5173")

        await asyncio.gather(
            audio_capture_loop(),
            broadcast_loop(),
            media_poll_loop(),
            extension_poll_loop(),
            fingerprint_poll_loop(),
            asyncio.Future(),
        )


if __name__ == "__main__":
    asyncio.run(main())
