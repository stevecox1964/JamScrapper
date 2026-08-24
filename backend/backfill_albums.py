"""One-off: fill tracks.album for the catalog rows that never got one.

The column shipped with the table and nothing ever wrote to it, so all 624
rows were blank. Run this once; after it, server.py keeps new rows filled.

Safe to stop and re-run — it only touches rows that are still blank, so a
second run picks up where the first stopped.

    python backfill_albums.py            # do it
    python backfill_albums.py --dry-run  # look first, change nothing
    python backfill_albums.py --limit 20 # try a handful
"""

import argparse
import io
import sys
import time

from db import get_db
from artist_store import fetch_album_from_musicbrainz, MusicBrainzUnavailable

# MusicBrainz asks for no more than one request a second. Be a good citizen:
# this is their free service and there is no hurry.
RATE_LIMIT_SECONDS = 1.6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="show what would change")
    ap.add_argument("--limit", type=int, default=0, help="only do this many")
    args = ap.parse_args()

    # Album titles are full of accents and dashes that a Windows console
    # refuses to print. Never let that kill a long run.
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    conn = get_db()
    rows = conn.execute(
        "SELECT artist, title FROM tracks "
        "WHERE album IS NULL OR album = '' ORDER BY artist, title"
    ).fetchall()
    if args.limit:
        rows = rows[: args.limit]

    total = len(rows)
    if not total:
        print("Nothing to do — every catalog row already has an album.")
        return

    mode = "DRY RUN — nothing will be written" if args.dry_run else "writing to the catalog"
    print(f"{total} songs with no album. {mode}.")
    print(f"About {int(total * RATE_LIMIT_SECONDS / 60) + 1} minutes at MusicBrainz's rate limit.\n")

    found = blank = failed = unavailable = 0
    for i, row in enumerate(rows, 1):
        artist, title = row["artist"], row["title"]
        try:
            album = fetch_album_from_musicbrainz(artist, title)
        except MusicBrainzUnavailable as e:
            # Not the same as "no album" — the row stays blank and a later run
            # will pick it up, because this script only touches blank rows.
            unavailable += 1
            print(f"[{i}/{total}] SERVER BUSY  {artist} - {title}: {e}")
            time.sleep(RATE_LIMIT_SECONDS * 3)
            continue
        except Exception as e:
            failed += 1
            print(f"[{i}/{total}] ERROR  {artist} - {title}: {e}")
            time.sleep(RATE_LIMIT_SECONDS)
            continue

        if album:
            if not args.dry_run:
                # The app may be running and holding the database. A lock is a
                # failure, not a skip — say so rather than silently losing it.
                try:
                    conn.execute(
                        "UPDATE tracks SET album = ? "
                        "WHERE artist = ? AND title = ? AND (album IS NULL OR album = '')",
                        (album, artist, title),
                    )
                    conn.commit()
                except Exception as e:
                    failed += 1
                    print(f"[{i}/{total}] WRITE FAILED  {artist} - {title}: {e}")
                    time.sleep(RATE_LIMIT_SECONDS)
                    continue
            found += 1
            print(f"[{i}/{total}] OK     {artist} - {title}  ->  {album}")
        else:
            blank += 1
            # Deliberately loud. A blank means MusicBrainz had nothing that
            # looked like a real studio album — better than writing a bootleg.
            print(f"[{i}/{total}] BLANK  {artist} - {title}  (no confident album)")

        time.sleep(RATE_LIMIT_SECONDS)

    print(f"\n{'-' * 60}")
    print(f"  filled : {found}/{total}  ({round(100 * found / total)}%)")
    print(f"  blank  : {blank}   (left empty on purpose — no confident match)")
    print(f"  busy   : {unavailable}   (MusicBrainz unavailable — re-run to retry these)")
    print(f"  errors : {failed}")
    if unavailable:
        print("")
        print(f"  {unavailable} songs never got looked up. Run this again to catch them.")
    if args.dry_run:
        print("\nDry run — the catalog was not changed.")


if __name__ == "__main__":
    main()
