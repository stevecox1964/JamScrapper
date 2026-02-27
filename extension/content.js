// Intercept MediaSession metadata + poll DOM for player info
const BACKEND = "http://localhost:8766/track";
let lastSent = "";

function send(artist, title, album, artwork) {
  const key = `${artist}|||${title}`;
  if (key === lastSent || (!artist && !title)) return;
  fetch(BACKEND, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist, title, album, artwork }),
  }).then(() => {
    lastSent = key; // Only mark sent on success so we retry if backend was down
  }).catch(() => {});
}

// 1. Intercept MediaSession metadata writes
try {
  const desc = Object.getOwnPropertyDescriptor(MediaSession.prototype, "metadata");
  if (desc && desc.set) {
    const origSet = desc.set;
    Object.defineProperty(navigator.mediaSession, "metadata", {
      set(val) {
        if (val) send(val.artist, val.title, val.album, val.artwork?.[0]?.src);
        return origSet.call(this, val);
      },
      get() { return desc.get.call(this); },
      configurable: true,
    });
  }
} catch (e) {}

// 1b. Read existing metadata on load (in case it was set before our intercept)
try {
  const existing = navigator.mediaSession?.metadata;
  if (existing) {
    send(existing.artist, existing.title, existing.album, existing.artwork?.[0]?.src);
  }
} catch (e) {}

// 2. Poll DOM for common player selectors
const SELECTORS = [
  // Pandora
  { artist: '.Tuner__Audio__TrackDetail__artist', title: '.Tuner__Audio__TrackDetail__title' },
  { artist: '[data-qa="mini_track_artist_name"]', title: '[data-qa="mini_track_title"]' },
  { artist: '.nowPlayingTopInfo__current__artistName', title: '.nowPlayingTopInfo__current__trackName' },
  // YouTube Music
  { artist: '.byline.ytmusic-player-bar .yt-formatted-string', title: '.title.ytmusic-player-bar .yt-formatted-string' },
  // Spotify
  { artist: '[data-testid="context-item-info-artist"]', title: '[data-testid="context-item-link"]' },
  // SoundCloud
  { artist: '.playbackSoundBadge__titleContextContainer a:last-child', title: '.playbackSoundBadge__titleLink' },
];

function pollDOM() {
  for (const sel of SELECTORS) {
    const aEl = document.querySelector(sel.artist);
    const tEl = document.querySelector(sel.title);
    const artist = aEl?.textContent?.trim() || "";
    const title = tEl?.textContent?.trim() || "";
    if (artist || title) {
      send(artist, title, "", "");
      return;
    }
  }
}

setInterval(pollDOM, 3000);
pollDOM();
