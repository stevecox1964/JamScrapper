"""
Diagnostic script: test if Windows Media Session API can detect what's playing.
Run this while music is playing (Spotify, YouTube, Pandora, etc.).
"""
import asyncio
import sys

print("=" * 60)
print("MEDIA SESSION DIAGNOSTIC")
print("=" * 60)

# Step 1: Check WinRT imports
print("\n[1] Checking WinRT imports...")
try:
    from winrt.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    )
    print("    OK: winrt.windows.media.control imported")
except ImportError as e:
    print(f"    FAIL: Cannot import winrt media control: {e}")
    print("    Fix: pip install winrt-Windows.Media.Control winrt-runtime")
    sys.exit(1)

try:
    from winrt.windows.storage.streams import Buffer, InputStreamOptions
    print("    OK: winrt.windows.storage.streams imported")
except ImportError as e:
    print(f"    WARN: Cannot import streams (album art won't work): {e}")


async def diagnose():
    # Step 2: Request session manager
    print("\n[2] Requesting media session manager...")
    try:
        sessions = await MediaManager.request_async()
        print(f"    OK: Got session manager: {type(sessions)}")
    except Exception as e:
        print(f"    FAIL: request_async() raised: {type(e).__name__}: {e}")
        return

    # Step 3: Check current session
    print("\n[3] Checking current (active) session...")
    try:
        current = sessions.get_current_session()
        if current is None:
            print("    WARN: No current session (no active media player)")
        else:
            print(f"    OK: Current session found: {current.source_app_user_model_id}")
    except Exception as e:
        print(f"    FAIL: get_current_session() raised: {type(e).__name__}: {e}")
        current = None

    # Step 4: List all sessions
    print("\n[4] Listing all media sessions...")
    try:
        all_sessions = sessions.get_sessions()
        count = all_sessions.size
        print(f"    Found {count} session(s)")
        for i in range(count):
            s = all_sessions.get_at(i)
            print(f"    [{i}] App: {s.source_app_user_model_id}")
    except Exception as e:
        print(f"    FAIL: get_sessions() raised: {type(e).__name__}: {e}")
        count = 0

    if count == 0 and current is None:
        print("\n    >>> NO MEDIA SESSIONS FOUND <<<")
        print("    Make sure you're playing music in Spotify, YouTube, Pandora, etc.")
        print("    Some apps only register a media session while actively playing.")
        return

    # Step 5: Try to read media properties from each session
    print("\n[5] Reading media properties from each session...")
    targets = []
    if current is not None:
        targets.append(("current", current))
    try:
        all_sessions = sessions.get_sessions()
        for i in range(all_sessions.size):
            targets.append((f"session[{i}]", all_sessions.get_at(i)))
    except Exception:
        pass

    for label, session in targets:
        print(f"\n    --- {label}: {session.source_app_user_model_id} ---")
        try:
            props = await session.try_get_media_properties_async()
            if props is None:
                print("    props is None")
                continue

            artist = (props.artist or "").strip()
            title = (props.title or "").strip()
            album = (props.album_title or "").strip()
            print(f"    Artist:  '{artist}'")
            print(f"    Title:   '{title}'")
            print(f"    Album:   '{album}'")

            if not artist and not title:
                print("    WARN: Both artist and title are empty")
            else:
                print("    >>> DETECTION WORKS! <<<")

            # Check thumbnail
            if props.thumbnail:
                print("    Thumbnail: present")
                try:
                    stream = await props.thumbnail.open_read_async()
                    print(f"    Thumbnail stream opened (content type: {stream.content_type})")
                    stream.close()
                except Exception as te:
                    print(f"    Thumbnail read error: {te}")
            else:
                print("    Thumbnail: None")

        except Exception as e:
            print(f"    FAIL: try_get_media_properties_async() raised: {type(e).__name__}: {e}")

    print("\n" + "=" * 60)
    print("DIAGNOSTIC COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(diagnose())
