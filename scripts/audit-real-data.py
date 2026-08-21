"""Scan every git-tracked file for real student records.

Written after finding 144,236 rows of real per-student data sitting in tracked `.parquet`
reports that arrived with the original archive. The gitignore rules added later never applied
to them because the files were already in the index — ignoring a path only stops it being
added, never stops one already tracked from being shipped.

This scans the actual tracked set rather than trusting the ignore rules, so the same class of
miss cannot happen quietly again. Run it before any hand-off.

Usage:  python scripts/audit-real-data.py [--fix]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Real ids occupy 1..36059; synthetic ids are drawn from 90000..99999. Any id in the real
#: band inside a tracked file is a real student record until proven otherwise.
REAL_ID_MAX = 36059
SYNTHETIC_ID_MIN = 90000

#: Files that legitimately contain student-shaped ids because every one is synthetic.
ALLOWED = {
    "src/lib/aptams/data/cohort.json",
    "data/synthetic/handoff_fixtures.json",
}

#: Extensions worth opening. Anything tabular is the high-risk case.
TABULAR = {".parquet", ".csv", ".feather", ".pkl", ".xlsx"}
TEXTUAL = {".json", ".jsonl", ".md", ".txt", ".ts", ".tsx", ".py"}


#: Directories never worth scanning — build output and dependencies, not authored content.
SKIP_DIRS = {".git", "node_modules", ".next", "dist", "__pycache__", ".venv", ".turbo"}


def tracked_files() -> list[str]:
    """The git-tracked set, or every file under ROOT when git is unavailable.

    The hand-off zip deliberately ships without a `.git` directory, so this has to work
    outside a repository too — an audit that only runs where the developer already knows the
    answer is not much of an audit.
    """
    try:
        out = subprocess.run(
            ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
        )
        return [line for line in out.stdout.splitlines() if line.strip()]
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("(no git repository - scanning the working tree instead)\n")
        files = []
        for path in ROOT.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT)
            if any(part in SKIP_DIRS for part in rel.parts):
                continue
            files.append(rel.as_posix())
        return sorted(files)


def scan_tabular(path: Path) -> tuple[int, list[str]]:
    """Row count and any student-id-like column values in the real band."""
    try:
        import pandas as pd
    except ImportError:
        return -1, []

    try:
        if path.suffix == ".parquet":
            df = pd.read_parquet(path)
        elif path.suffix == ".csv":
            df = pd.read_csv(path)
        else:
            return -1, []
    except (OSError, ValueError, ImportError):
        # Unreadable is not the same as clean, but a file this scanner cannot parse is also
        # one it cannot clear, so it is reported as unscanned rather than silently passed.
        return -1, []

    candidates: list[str] = []
    series = []
    if df.index.name == "student_id":
        series.append(df.index.to_series())
    for col in df.columns:
        if "student" in str(col).lower() or "id" == str(col).lower():
            series.append(df[col])

    for s in series:
        for value in s.astype(str).head(20000):
            if value.isdigit() and 1 <= int(value) <= REAL_ID_MAX:
                candidates.append(value)
                if len(candidates) >= 5:
                    return len(df), candidates
    return len(df), candidates


def scan_json(path: Path) -> list[str]:
    """Student ids in the real band inside a JSON document."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []

    found: list[str] = []

    def walk(node: object) -> None:
        if len(found) >= 5:
            return
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"student_id", "subject", "id"} and isinstance(value, (str, int)):
                    text = str(value)
                    if text.isdigit() and 1 <= int(text) <= REAL_ID_MAX:
                        found.append(text)
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="Scan tracked files for real student records.")
    ap.add_argument("--fix", action="store_true", help="git rm --cached anything that fails")
    args = ap.parse_args()

    offenders: list[tuple[str, str]] = []
    scanned = 0

    for rel in tracked_files():
        if rel in ALLOWED:
            continue
        path = ROOT / rel
        if not path.exists():
            continue
        suffix = path.suffix.lower()

        if suffix in TABULAR:
            scanned += 1
            rows, ids = scan_tabular(path)
            if ids:
                offenders.append((rel, f"{rows:,} rows, real ids e.g. {', '.join(ids[:3])}"))
            elif rows > 0 and suffix == ".parquet":
                # A tabular report with no id column is still per-student data if it is long.
                offenders.append((rel, f"{rows:,} rows of tabular data, no id column checked"))
        elif suffix in TEXTUAL and path.stat().st_size < 20_000_000:
            scanned += 1
            if suffix == ".json":
                ids = scan_json(path)
                if ids:
                    offenders.append((rel, f"real ids e.g. {', '.join(ids[:3])}"))

    print(f"Scanned {scanned} tracked files.\n")
    if not offenders:
        print("OK - no real student records found in tracked files.")
        return 0

    print(f"FAIL - {len(offenders)} tracked file(s) contain real student data:\n")
    for rel, why in offenders:
        print(f"  {rel}\n      {why}")

    if args.fix:
        print("\nUntracking (files stay on disk):")
        for rel, _ in offenders:
            subprocess.run(["git", "rm", "--cached", "-q", rel], cwd=ROOT, check=False)
            print(f"  removed from index: {rel}")
        print("\nCommit this, then purge them from history if the repo was ever shared.")
    else:
        print("\nRe-run with --fix to untrack them.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
