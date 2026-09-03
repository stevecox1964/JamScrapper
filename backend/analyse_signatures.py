"""Measure song signatures for the mp4 files on disk.

Rando steers on genre tags today. This batch measures the audio itself
(loudness, dynamics, brightness, key) and stores one row per video_id in
the `signatures` table. See signature_store.py for what each number means.

Resumable: it only touches songs that have no signature yet, so stopping
and re-running picks up where it left off. Every file it cannot measure is
printed WITH THE REASON -- a silent skip here is the bug we are avoiding.

    python analyse_signatures.py --limit 10   # first look: ten songs
    python analyse_signatures.py              # the whole backlog
    python analyse_signatures.py --table      # print what is stored, measure nothing
"""

import argparse
import io
import sys
import time

from db import get_db, init_db
from signature_store import SignatureStore, SignatureAnalysisError


def print_table(conn):
    rows = conn.execute(
        "SELECT s.video_id, t.artist, t.title, s.bpm, s.energy, s.dynamics, "
        "s.brightness, s.key, s.mode "
        "FROM signatures s LEFT JOIN tracks t USING (video_id) "
        "ORDER BY s.energy DESC"
    ).fetchall()
    if not rows:
        print("No signatures stored yet.")
        return
    print(f"{'artist':<22} {'title':<30} {'bpm':>6} {'energy':>7} {'dynam':>7} {'bright':>7}  key")
    print("-" * 96)
    for r in rows:
        artist = (r["artist"] or "?")[:22]
        title = (r["title"] or r["video_id"])[:30]
        print(f"{artist:<22} {title:<30} {r['bpm']:>6.1f} {r['energy']:>7.3f} "
              f"{r['dynamics']:>7.3f} {r['brightness']:>7.0f}  {r['key']} {r['mode']}")
    print(f"\n{len(rows)} signatures stored.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only measure this many")
    ap.add_argument("--table", action="store_true", help="print stored rows, measure nothing")
    args = ap.parse_args()

    conn = get_db()
    init_db(conn)
    store = SignatureStore(conn)

    if args.table:
        print_table(conn)
        return

    pending = store.pending()
    if args.limit:
        pending = pending[: args.limit]
    print(f"{len(pending)} songs to measure.\n")

    done, failed = 0, []
    started = time.time()
    for i, track in enumerate(pending, 1):
        label = f"{track['artist']} - {track['title']}"
        t0 = time.time()
        try:
            store.analyse_and_save(track["video_id"])
            done += 1
            print(f"[{i}/{len(pending)}] ok   {label}  ({time.time() - t0:.1f}s)")
        except SignatureAnalysisError as e:
            failed.append((label, str(e)))
            print(f"[{i}/{len(pending)}] FAIL {label}: {e}")
        except Exception as e:  # unexpected -- still record it, still keep going
            failed.append((label, f"{type(e).__name__}: {e}"))
            print(f"[{i}/{len(pending)}] FAIL {label}: {type(e).__name__}: {e}")

    print(f"\nMeasured {done}, failed {len(failed)}, {time.time() - started:.0f}s total.")
    if failed:
        print("\nFailed files and why:")
        for label, reason in failed:
            print(f"  {label}: {reason}")

    print()
    print_table(conn)


if __name__ == "__main__":
    # Windows consoles default to a codepage that chokes on artist names.
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    main()
