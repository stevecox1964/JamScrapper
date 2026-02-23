import json
import os
import re
import asyncio
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

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
        # Sort by count descending, take top tags
        tags.sort(key=lambda t: t.get("count", 0), reverse=True)
        genres = [t["name"].lower() for t in tags[:10] if t.get("name")]
        return genres, mbid
    except Exception as e:
        print(f"MusicBrainz error: {e}")
        return [], ""


# ---------- Mood/visualizer derivation ----------

def derive_mood_tags(genres):
    """Map genre list to mood descriptors."""
    moods = set()
    for genre in genres:
        gl = genre.lower()
        # Direct match
        if gl in GENRE_MOOD_MAP:
            moods.update(GENRE_MOOD_MAP[gl])
            continue
        # Substring match
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
        # Substring match
        for key, mode in GENRE_VISUALIZER_MAP.items():
            if key in gl or gl in key:
                return mode
    return "bars"


# ---------- ArtistStore ----------

class ArtistStore:
    def __init__(self, data_dir=None):
        if data_dir is None:
            data_dir = Path(__file__).parent / "data" / "artists"
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def slugify(name):
        """Convert artist name to a filesystem-safe slug."""
        slug = name.lower().strip()
        slug = re.sub(r"[^a-z0-9]+", "-", slug)
        return slug.strip("-") or "unknown"

    def _profile_path(self, slug):
        return self.data_dir / f"{slug}.json"

    def load(self, artist_name):
        """Load an existing artist profile, or return None."""
        slug = self.slugify(artist_name)
        path = self._profile_path(slug)
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def save(self, profile):
        """Save an artist profile to disk."""
        profile["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        path = self._profile_path(profile["slug"])
        with open(path, "w", encoding="utf-8") as f:
            json.dump(profile, f, indent=2, ensure_ascii=False)

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
        # Check if song already tracked
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


# ---------- Enrichment orchestrator ----------

async def enrich_artist_profile(store, artist_name, images=None):
    """Build or update a full artist profile with images, colors, genres, moods."""
    profile = store.get_or_create(artist_name)

    # Update images if provided and different
    if images and images != profile.get("images"):
        profile["images"] = images

    changed = False

    # Fetch genres from MusicBrainz if missing
    if not profile.get("genres"):
        genres, mbid = await asyncio.to_thread(fetch_genres_from_musicbrainz, artist_name)
        if genres:
            profile["genres"] = genres
            changed = True

    # Derive mood tags from genres
    if profile.get("genres") and not profile.get("moodTags"):
        profile["moodTags"] = derive_mood_tags(profile["genres"])
        changed = True

    # Derive preferred visualizer from genres
    if profile.get("genres") and not profile.get("preferredVisualizer"):
        profile["preferredVisualizer"] = derive_preferred_visualizer(profile["genres"])
        changed = True

    # Extract dominant colors from first image
    if profile.get("images") and not profile.get("dominantColors"):
        colors = await asyncio.to_thread(extract_dominant_colors, profile["images"][0])
        if colors:
            profile["dominantColors"] = colors
            changed = True

    if changed or not profile.get("lastUpdated"):
        store.save(profile)

    return profile
