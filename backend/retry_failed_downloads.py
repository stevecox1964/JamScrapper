"""Retry every download that failed and left no playable file.

The old downloader recorded "yt-dlp exited with code 1" and nothing else, then left
its fragments on disk forever. This walks the failed rows and tries each one again,
reporting exactly what happened to every single track -- no silent skips.

    python backend/retry_failed_downloads.py [--limit N] [--dry-run]

Safe to stop and re-run: anything already on disk is skipped.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from db import get_db
from video_downloader import VideoDownloader


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N attempts")
    ap.add_argument("--dry-run", action="store_true", help="list what would be retried")
    args = ap.parse_args()

    conn = get_db()
    dl = VideoDownloader(conn)

    rows = conn.execute(
        "SELECT video_id, artist, title, video_title FROM downloads "
        "WHERE state = 'failed' ORDER BY queued_at"
    ).fetchall()

    todo = [r for r in rows if not dl.is_downloaded(r["video_id"])]
    already = len(rows) - len(todo)

    print(f"failed rows: {len(rows)}")
    print(f"already on disk (will be marked completed): {already}")
    print(f"to retry: {len(todo)}")
    if args.limit:
        todo = todo[: args.limit]
        print(f"limited to: {len(todo)}")
    print()

    if args.dry_run:
        for r in todo:
            print(f"  {r['video_id']}  {r['artist']} - {r['title']}")
        return

    fixed, still_failing = [], []
    started = time.time()

    for i, r in enumerate(todo, 1):
        vid = r["video_id"]
        label = f"{r['artist']} - {r['title']}"
        print(f"[{i}/{len(todo)}] {label}  ({vid})", flush=True)

        status = dl.download_video(
            vid, r["artist"] or "", r["title"] or "", r["video_title"] or label
        )

        if status and status.get("state") == "completed":
            fixed.append((vid, label, status.get("fileSizeMB")))
            print(f"    OK  {status.get('fileSizeMB')} MB", flush=True)
        else:
            err = (status or {}).get("error") or "no status returned"
            still_failing.append((vid, label, err))
            print(f"    FAILED  {err}", flush=True)

    mins = (time.time() - started) / 60
    print()
    print("=" * 70)
    print(f"attempted    : {len(todo)}   in {mins:.1f} min")
    print(f"fixed        : {len(fixed)}")
    print(f"still failing: {len(still_failing)}")
    if still_failing:
        print("\nStill failing -- these need a decision, not another retry:")
        for vid, label, err in still_failing:
            print(f"  {vid}  {label}\n      {err}")


if __name__ == "__main__":
    main()
