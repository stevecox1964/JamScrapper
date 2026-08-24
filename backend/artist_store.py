import re
import time
import asyncio
from datetime import datetime, timezone
from io import BytesIO

import requests
from PIL import Image

from db import json_loads, json_dumps

# ---------- Genre/mood/visualizer mappings ----------

GENRE_MOOD_MAP = {
    "rock": ["energetic", "powerful"],
    "alternative rock": ["energetic", "moody"],
    "indie rock": ["energetic", "raw"],
    "metal": ["intense", "aggressive"],
    "heavy metal": ["intense", "aggressive"],
    "death metal": ["intense", "dark"],
    "pop": ["upbeat", "bright"],
    "synth-pop": ["upbeat", "synthetic"],
    "electronic": ["pulsing", "synthetic"],
    "edm": ["pulsing", "energetic"],
    "house": ["pulsing", "groovy"],
    "techno": ["pulsing", "hypnotic"],
    "drum and bass": ["pulsing", "intense"],
    "ambient": ["dreamy", "atmospheric"],
    "jazz": ["smooth", "sophisticated"],
    "classical": ["elegant", "flowing"],
    "hip hop": ["rhythmic", "bold"],
    "rap": ["rhythmic", "bold"],
    "r&b": ["smooth", "soulful"],
    "soul": ["smooth", "soulful"],
    "country": ["warm", "earthy"],
    "folk": ["organic", "gentle"],
    "punk": ["raw", "energetic"],
    "punk rock": ["raw", "energetic"],
    "blues": ["soulful", "deep"],
    "reggae": ["relaxed", "groovy"],
    "latin": ["rhythmic", "warm"],
    "funk": ["groovy", "bold"],
}

GENRE_VISUALIZER_MAP = {
    "electronic": "tunnel",
    "edm": "tunnel",
    "house": "tunnel",
    "techno": "tunnel",
    "drum and bass": "tunnel",
    "ambient": "starfield",
    "classical": "starfield",
    "metal": "terrain",
    "heavy metal": "terrain",
    "death metal": "terrain",
    "rock": "bars",
    "alternative rock": "bars",
    "punk": "bars",
    "pop": "radial",
    "synth-pop": "radial",
    "jazz": "galaxy",
    "soul": "galaxy",
    "r&b": "galaxy",
    "hip hop": "bars",
    "rap": "bars",
    "folk": "waveform",
    "blues": "waveform",
    "country": "waveform",
    "reggae": "radial",
    "funk": "radial",
    "latin": "radial",
}

MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2"
MUSICBRAINZ_HEADERS = {
    "User-Agent": "VisualAudioScraper/1.0 (github.com/stevecox1964/JamScrapper)",
    "Accept": "application/json",
}


# ---------- Color extraction ----------

def extract_dominant_colors(image_url, num_colors=5):
    """Download an image and extract dominant colors using Pillow quantization."""
    try:
        resp = requests.get(image_url, timeout=10)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGB")
        img = img.resize((150, 150), Image.LANCZOS)
        quantized = img.quantize(colors=num_colors, method=Image.Quantize.MEDIANCUT)
        palette = quantized.getpalette()[:num_colors * 3]
        colors = [palette[i:i + 3] for i in range(0, len(palette), 3)]
        return colors
    except Exception as e:
        print(f"Color extraction error: {e}")
        return []


# ---------- MusicBrainz genre fetch ----------

def fetch_genres_from_musicbrainz(artist_name):
    """Fetch genre/style tags for an artist from MusicBrainz."""
    try:
        resp = requests.get(
            f"{MUSICBRAINZ_BASE}/artist",
            params={"query": f'artist:"{artist_name}"', "fmt": "json", "limit": 1},
            headers=MUSICBRAINZ_HEADERS,
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        artists = data.get("artists", [])
        if not artists:
            return [], ""

        artist = artists[0]
        mbid = artist.get("id", "")
        tags = artist.get("tags", [])
        tags.sort(key=lambda t: t.get("count", 0), reverse=True)
        genres = [t["name"].lower() for t in tags[:10] if t.get("name")]
        return genres, mbid
    except Exception as e:
        print(f"MusicBrainz error: {e}")
        return [], ""


# ---------- MusicBrainz album fetch ----------

# Release-group secondary types that mean "this is not the album the song came
# from": live sets, hits compilations, soundtracks and so on.
NOT_THE_ALBUM = {
    "live", "compilation", "soundtrack", "remix", "dj-mix",
    "demo", "mixtape/street", "interview", "audiobook", "spokenword",
}


# Bracketed suffixes that are about the *pressing*, not the song. Stripping
# these is what makes "cherub rock (2011 remaster)" findable. Anything else in
# brackets is left alone, because plenty of real titles need it --
# "movin' out (anthony's song)", "(you gotta) fight for your right (to party!)".
VERSION_NOISE = re.compile(
    r"\s*[\(\[][^\)\]]*("
    r"remaster(ed)?|re-?master|version|edit|mix|mono|stereo|deluxe|bonus|"
    r"anniversary|reissue|remix|radio edit|album version|explicit|clean|"
    r"[0-9]{4}|digital"
    r")[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


def _strip_version_noise(title):
    """'song 2 (2012 remaster)' -> 'song 2'. Returns "" if nothing was stripped."""
    cleaned = VERSION_NOISE.sub("", title or "").strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    if not cleaned or cleaned.lower() == (title or "").strip().lower():
        return ""
    return cleaned


class MusicBrainzUnavailable(Exception):
    """The server was busy or down. Says nothing about whether an album exists.

    Kept separate from a blank result on purpose: a blank means "we looked and
    found no studio album", which is a real answer worth recording. This means
    "we never got to look", and the caller should try again later rather than
    write the song off.
    """


def fetch_album_from_musicbrainz(artist_name, title):
    """Find the studio album a song first appeared on. Returns "" if unsure.

    The old version asked for one recording and took its first release. That is
    close to random: MusicBrainz attaches bootlegs and live sets to a recording
    just as readily as the real album, and it returned things like
    "1992-12-20: Seattle Center Arena" as the album for "Man in the Box".

    So: scan every strong recording match, keep only official, Album-type
    releases that are not live/compilation/soundtrack, and take the earliest —
    the album a song first appeared on is the one people mean. A blank is
    better than a wrong album, so anything that fails the filter returns "".
    """
    for attempt_title in (title, _strip_version_noise(title)):
        if not attempt_title:
            continue
        album = _album_query(artist_name, attempt_title)
        if album:
            return album
    return ""


def _album_query(artist_name, title, retries=2):
    """One MusicBrainz search. Returns the best album title, or "".

    Raises MusicBrainzUnavailable if the server would not answer, so a busy
    server is never mistaken for a song that has no album.
    """
    resp = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(
                f"{MUSICBRAINZ_BASE}/recording",
                params={
                    "query": f'recording:"{title}" AND artist:"{artist_name}"',
                    "fmt": "json",
                    "limit": 100,
                },
                headers=MUSICBRAINZ_HEADERS,
                timeout=15,
            )
        except requests.RequestException as e:
            if attempt == retries:
                raise MusicBrainzUnavailable(str(e)) from e
            time.sleep(2 * (attempt + 1))
            continue
        # 503 means "slow down" far more often than it means "broken".
        if resp.status_code in (429, 500, 502, 503, 504):
            if attempt == retries:
                raise MusicBrainzUnavailable(f"HTTP {resp.status_code}")
            time.sleep(2 * (attempt + 1))
            continue
        break

    try:
        resp.raise_for_status()

        best_date, best_title = None, ""
        for rec in resp.json().get("recordings", []):
            # A weak name match is usually a different song entirely.
            if (rec.get("score") or 0) < 90:
                continue
            for rel in rec.get("releases", []):
                if rel.get("status") != "Official":
                    continue
                group = rel.get("release-group") or {}
                if (group.get("primary-type") or "") != "Album":
                    continue
                secondary = {s.lower() for s in (group.get("secondary-types") or [])}
                if secondary & NOT_THE_ALBUM:
                    continue
                date = group.get("first-release-date") or rel.get("date") or ""
                if not date:
                    continue
                if best_date is None or date < best_date:
                    best_date = date
                    best_title = group.get("title") or rel.get("title") or ""
        return best_title
    except Exception as e:
        print(f"MusicBrainz album lookup error: {e}")
        return ""


# ---------- Mood/visualizer derivation ----------

def derive_mood_tags(genres):
    """Map genre list to mood descriptors."""
    moods = set()
    for genre in genres:
        gl = genre.lower()
        if gl in GENRE_MOOD_MAP:
            moods.update(GENRE_MOOD_MAP[gl])
            continue
        for key, vals in GENRE_MOOD_MAP.items():
            if key in gl or gl in key:
                moods.update(vals)
                break
    return list(moods)


def derive_preferred_visualizer(genres):
    """Pick a visualizer mode based on genre list (first match wins)."""
    for genre in genres:
        gl = genre.lower()
        if gl in GENRE_VISUALIZER_MAP:
            return GENRE_VISUALIZER_MAP[gl]
        for key, mode in GENRE_VISUALIZER_MAP.items():
            if key in gl or gl in key:
                return mode
    return "bars"


# ---------- ArtistStore ----------

class ArtistStore:
    def __init__(self, conn):
        self._conn = conn

    @staticmethod
    def slugify(name):
        """Convert artist name to a filesystem-safe slug."""
        slug = name.lower().strip()
        slug = re.sub(r"[^a-z0-9]+", "-", slug)
        return slug.strip("-") or "unknown"

    def load(self, artist_name):
        """Load an existing artist profile, or return None."""
        slug = self.slugify(artist_name)
        row = self._conn.execute("SELECT * FROM artists WHERE slug = ?", (slug,)).fetchone()
        if not row:
            return None
        return self._row_to_profile(row)

    def save(self, profile):
        """Save an artist profile to the database."""
        profile["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        self._conn.execute("""
            INSERT OR REPLACE INTO artists
                (slug, name, images, dominant_colors, genres, mood_tags,
                 preferred_visualizer, songs, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            profile["slug"],
            profile["name"],
            json_dumps(profile.get("images", [])),
            json_dumps(profile.get("dominantColors", [])),
            json_dumps(profile.get("genres", [])),
            json_dumps(profile.get("moodTags", [])),
            profile.get("preferredVisualizer", ""),
            json_dumps(profile.get("songs", [])),
            profile["lastUpdated"],
        ))
        self._conn.commit()

    def get_or_create(self, artist_name):
        """Load existing profile or create a skeleton."""
        existing = self.load(artist_name)
        if existing:
            return existing
        return {
            "name": artist_name,
            "slug": self.slugify(artist_name),
            "images": [],
            "dominantColors": [],
            "genres": [],
            "moodTags": [],
            "preferredVisualizer": "",
            "songs": [],
            "lastUpdated": "",
        }

    def update_song(self, artist_name, title, album="", musicbrainz_id=""):
        """Add a song to the artist profile if not already present."""
        profile = self.get_or_create(artist_name)
        for song in profile["songs"]:
            if song["title"].lower() == title.lower():
                return profile
        profile["songs"].append({
            "title": title,
            "album": album,
            "musicbrainzId": musicbrainz_id,
        })
        self.save(profile)
        return profile

    def needs_enrichment(self, profile):
        """Check if the profile is missing key data."""
        if not profile.get("genres"):
            return True
        if not profile.get("dominantColors") and profile.get("images"):
            return True
        return False

    @staticmethod
    def _row_to_profile(row):
        """Convert a sqlite3.Row to the profile dict."""
        return {
            "name": row["name"],
            "slug": row["slug"],
            "images": json_loads(row["images"]),
            "dominantColors": json_loads(row["dominant_colors"]),
            "genres": json_loads(row["genres"]),
            "moodTags": json_loads(row["mood_tags"]),
            "preferredVisualizer": row["preferred_visualizer"],
            "songs": json_loads(row["songs"]),
            "lastUpdated": row["last_updated"],
        }


# ---------- Enrichment orchestrator ----------

async def enrich_artist_profile(store, artist_name, images=None):
    """Build or update a full artist profile with images, colors, genres, moods."""
    profile = store.get_or_create(artist_name)

    if images and images != profile.get("images"):
        profile["images"] = images

    changed = False

    if not profile.get("genres"):
        genres, mbid = await asyncio.to_thread(fetch_genres_from_musicbrainz, artist_name)
        if genres:
            profile["genres"] = genres
            changed = True

    if profile.get("genres") and not profile.get("moodTags"):
        profile["moodTags"] = derive_mood_tags(profile["genres"])
        changed = True

    if profile.get("genres") and not profile.get("preferredVisualizer"):
        profile["preferredVisualizer"] = derive_preferred_visualizer(profile["genres"])
        changed = True

    if profile.get("images") and not profile.get("dominantColors"):
        colors = await asyncio.to_thread(extract_dominant_colors, profile["images"][0])
        if colors:
            profile["dominantColors"] = colors
            changed = True

    if changed or not profile.get("lastUpdated"):
        store.save(profile)

    return profile
