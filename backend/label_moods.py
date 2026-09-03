"""Ask Claude for a mood label on every catalog song that lacks one.

Resumable: it only sends songs with no row in `moods`, so stopping and
re-running picks up where it left off. Every batch that fails is printed
WITH THE REASON and the run keeps going -- a silent skip is the bug we are
avoiding. Needs ANTHROPIC_API_KEY in the repo-root .env (see env.py).

    python label_moods.py --limit 10   # first look: ten songs
    python label_moods.py              # the whole backlog
    python label_moods.py --table      # print what is stored, label nothing
"""

import argparse
import io
import sys
import time

from env import load_env
load_env()

from db import get_db, init_db
from mood_store import MoodStore, MoodLabelError, BATCH_SIZE


def print_table(conn):
    rows = conn.execute(
        "SELECT m.*, t.artist, t.title FROM moods m "
        "LEFT JOIN tracks t USING (video_id) ORDER BY m.energy DESC, m.valence DESC"
    ).fetchall()
    if not rows:
        print("No moods stored yet.")
        return
    print(f"{'artist':<22} {'title':<30} {'nrg':>3} {'val':>3} {'ten':>3}  moods")
    print("-" * 90)
    for r in rows:
        artist = (r["artist"] or "?")[:22]
        title = (r["title"] or r["video_id"])[:30]
        moods = ", ".join(MoodStore._row(r)["moods"])
        print(f"{artist:<22} {title:<30} {r['energy']:>3} {r['valence']:>3} {r['tension']:>3}  {moods}")
    print(f"\n{len(rows)} moods stored.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only label this many songs")
    ap.add_argument("--table", action="store_true", help="print stored rows, label nothing")
    args = ap.parse_args()

    conn = get_db()
    init_db(conn)
    store = MoodStore(conn)

    if args.table:
        print_table(conn)
        return

    pending = store.pending()
    if args.limit:
        pending = pending[: args.limit]
    batches = [pending[i:i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
    print(f"{len(pending)} songs to label in {len(batches)} batches.\n")

    done, unknown, failed = 0, [], []
    started = time.time()
    for i, batch in enumerate(batches, 1):
        t0 = time.time()
        try:
            labels = store.label_batch(batch)
        except MoodLabelError as e:
            failed.append((batch, str(e)))
            print(f"[batch {i}/{len(batches)}] FAIL {len(batch)} songs: {e}")
            continue
        for track, label in zip(batch, labels):
            store.save(label)
            done += 1
            if not label["known"]:
                unknown.append(f"{track['artist']} - {track['title']}")
        print(f"[batch {i}/{len(batches)}] ok   {len(batch)} songs  ({time.time() - t0:.1f}s)")

    print(f"\nLabelled {done}, failed {sum(len(b) for b, _ in failed)}, "
          f"{time.time() - started:.0f}s total.")
    if unknown:
        print(f"\nClaude did not know {len(unknown)} songs (guessed from title and genres):")
        for name in unknown:
            print(f"  {name}")
    if failed:
        print("\nFailed batches and why:")
        for batch, reason in failed:
            print(f"  {batch[0]['artist']} ... ({len(batch)} songs): {reason}")

    print()
    print_table(conn)


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    main()
