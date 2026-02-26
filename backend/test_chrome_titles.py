"""Quick test: read Chrome window titles and try to parse tracks from them."""
import ctypes
import ctypes.wintypes

def get_chrome_window_titles():
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
            title = title.rsplit(" - Google Chrome", 1)[0].strip()
            titles.append(title)
        return True

    EnumWindows(EnumWindowsProc(callback), 0)
    return titles

STREAMING_SUFFIXES = [
    " - Pandora", " | Pandora", " – Pandora", " — Pandora",
    " - YouTube Music", " - YouTube", " - SoundCloud",
    " - Spotify", " | Spotify", " - Tidal", " - Deezer",
    " - Amazon Music", " - Apple Music", " - Qobuz",
]
TITLE_SPLITTERS = [" - ", " – ", " — ", " | ", " · "]

def parse_tab_title(title):
    if not title:
        return "", ""
    clean = title.strip()
    for suffix in sorted(STREAMING_SUFFIXES, key=len, reverse=True):
        if clean.endswith(suffix):
            clean = clean[: -len(suffix)].strip()
            break
    if not clean:
        return "", ""
    non_song = ["my collection", "stations", "browse", "search", "settings", "home", "library", "queue", "playlist"]
    if any(ns in clean.lower() for ns in non_song):
        return "", ""
    for sep in TITLE_SPLITTERS:
        if sep in clean:
            parts = [p.strip() for p in clean.split(sep, 1)]
            if len(parts) >= 2 and parts[0] and parts[1]:
                return parts[1], parts[0]  # artist, title
    return "", clean

print("Chrome window titles found:")
print("-" * 60)
titles = get_chrome_window_titles()
if not titles:
    print("  (none found)")
for t in titles:
    print(f"  Raw: '{t}'")
    artist, song = parse_tab_title(t)
    if artist or song:
        print(f"    -> Artist: '{artist}', Song: '{song}'")
    else:
        print(f"    -> (no track detected)")
print("-" * 60)
