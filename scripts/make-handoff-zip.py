"""Build the hand-off zip for Coze.

Two deliberate choices.

**Only git-tracked files go in.** Not a directory walk with an exclude list — an exclude list
fails open, and the thing it would fail open on is real student data. The tracked set is the
one `scripts/audit-real-data.py` verifies, so packaging exactly that set means the audit and
the artefact cannot disagree. It also drops `node_modules`, `.next`, `dist` and the working
scratch without needing rules for them.

**No `.git` directory.** Six per-student `.parquet` reports carrying 36,059 real student ids
were tracked in the original archive; they have been untracked, but they still exist in
history, and shipping history would ship them. Leaving history behind removes that entirely.

Written with `zipfile` rather than PowerShell `Compress-Archive`, which writes Windows-style
backslash separators that Linux tooling reads as filenames containing backslashes rather than
as directories.

Usage:  python scripts/make-handoff-zip.py [--out PATH]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Real ids run 1..36059. Anything in that band inside the archive is a real record.
REAL_ID_MAX = 36059

#: Files allowed to hold student-shaped ids, because every id in them is synthetic.
ID_BEARING_OK = {
    "src/lib/aptams/data/cohort.json",
    "data/synthetic/handoff_fixtures.json",
}


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return sorted(line for line in out.stdout.splitlines() if line.strip())


def main() -> int:
    ap = argparse.ArgumentParser(description="Package the app for hand-off.")
    ap.add_argument("--out", type=Path, default=Path.home() / "Desktop" / "aptams-for-coze.zip")
    args = ap.parse_args()

    files = tracked_files()
    if not files:
        print("No tracked files found — is this a git repository?", file=sys.stderr)
        return 1

    missing = [f for f in files if not (ROOT / f).exists()]
    if missing:
        print(f"Tracked but absent from disk ({len(missing)}): {missing[:5]}", file=sys.stderr)
        return 1

    # Refuse to package anything the audit would flag.
    bad = [f for f in files if Path(f).suffix.lower() == ".parquet"]
    if bad:
        print(f"Refusing to package per-student parquet reports: {bad}", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.out.exists():
        args.out.unlink()

    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in files:
            # arcname uses forward slashes explicitly; zipfile would otherwise inherit the
            # platform separator on Windows and produce an archive Linux cannot unpack.
            zf.write(ROOT / rel, arcname="aptams/" + rel.replace("\\", "/"))

    size_mb = args.out.stat().st_size / 1e6
    print(f"Wrote {args.out}")
    print(f"  files : {len(files):,}")
    print(f"  size  : {size_mb:.2f} MB")
    print("  .git  : excluded (history carried untracked real-data blobs)")

    # Verify what actually landed in the archive, rather than what we intended to put there.
    with zipfile.ZipFile(args.out) as zf:
        names = zf.namelist()
        assert not any(n.startswith("aptams/.git/") for n in names), ".git leaked into the zip"
        assert not any("\\" in n for n in names), "backslash path separators in the zip"
        assert not any(n.endswith(".parquet") for n in names), "parquet leaked into the zip"
        assert not any("node_modules/" in n for n in names), "node_modules leaked into the zip"

        for required in (
            "aptams/COZE_PROMPT.md",
            "aptams/AGENTS.md",
            "aptams/package.json",
            "aptams/src/lib/aptams/data/cohort.json",
            "aptams/src/lib/aptams/data/university_2014.json",
            "aptams/src/lib/aptams/data/cohort_sd.json",
        ):
            assert required in names, f"missing from the zip: {required}"

        import json

        cohort = json.loads(zf.read("aptams/src/lib/aptams/data/cohort.json"))
        assert cohort.get("synthetic") is True, "the packaged cohort is not marked synthetic"
        ids = [str(s["student_id"]) for s in cohort["students"]]
        real = [i for i in ids if i.isdigit() and int(i) <= REAL_ID_MAX]
        assert not real, f"real student ids in the packaged cohort: {real[:5]}"

    print("  verified: no .git, no parquet, no node_modules, cohort is synthetic")
    print(f"  ids     : {min(ids)}..{max(ids)} (synthetic band)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
