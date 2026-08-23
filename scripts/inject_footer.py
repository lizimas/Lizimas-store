#!/usr/bin/env python3
"""
inject_footer.py — write the canonical footer into every HTML page.

Strategy per file, first match wins:
  1. Replace everything between <!-- LZ_FOOTER_START --> and <!-- LZ_FOOTER_END -->
  2. Replace an existing <footer ...>...</footer> block
  3. Insert immediately before </body>

Dry run by default. Nothing is written without --apply.

Usage:
    python3 inject_footer.py --root public --partial public/partials/footer.html
    python3 inject_footer.py --root public --partial public/partials/footer.html --apply
"""

import argparse
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

ANCHOR_RE = re.compile(
    r"<!--\s*LZ_FOOTER_START\s*-->.*?<!--\s*LZ_FOOTER_END\s*-->",
    re.DOTALL | re.IGNORECASE,
)
FOOTER_RE = re.compile(r"<footer\b.*?</footer\s*>", re.DOTALL | re.IGNORECASE)
BODY_RE = re.compile(r"</body\s*>", re.IGNORECASE)

SKIP_DIRS = {"node_modules", ".git", "partials", "dist", "vendor"}


def find_pages(root: Path, extra_skip):
    skip = SKIP_DIRS | set(extra_skip)
    for path in sorted(root.rglob("*.html")):
        if any(part in skip for part in path.relative_to(root).parts[:-1]):
            continue
        yield path


def inject(text: str, footer: str):
    """Return (new_text, strategy) or (None, reason) if nothing to do."""
    if ANCHOR_RE.search(text):
        count = len(ANCHOR_RE.findall(text))
        if count > 1:
            return None, f"SKIP: {count} anchor blocks found, expected 1"
        return ANCHOR_RE.sub(lambda _: footer, text, count=1), "anchors"

    matches = FOOTER_RE.findall(text)
    if len(matches) > 1:
        return None, f"SKIP: {len(matches)} <footer> elements found, expected 1"
    if len(matches) == 1:
        return FOOTER_RE.sub(lambda _: footer, text, count=1), "replaced <footer>"

    if BODY_RE.search(text):
        return BODY_RE.sub(lambda m: footer + "\n" + m.group(0), text, count=1), "before </body>"

    return None, "SKIP: no anchors, no <footer>, no </body>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="directory to scan for .html files")
    ap.add_argument("--partial", required=True, help="path to canonical footer.html")
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--skip", nargs="*", default=[], help="extra directory names to skip")
    args = ap.parse_args()

    root = Path(args.root)
    partial = Path(args.partial)

    if not root.is_dir():
        sys.exit(f"error: --root {root} is not a directory")
    if not partial.is_file():
        sys.exit(f"error: --partial {partial} not found")

    footer = partial.read_text(encoding="utf-8").strip()
    if "LZ_FOOTER_START" not in footer or "LZ_FOOTER_END" not in footer:
        sys.exit("error: partial must contain both LZ_FOOTER_START and LZ_FOOTER_END comments")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    changed = skipped = unchanged = 0

    for page in find_pages(root, args.skip):
        rel = page.relative_to(root)
        original = page.read_text(encoding="utf-8")
        result, note = inject(original, footer)

        if result is None:
            print(f"  {rel}  ->  {note}")
            skipped += 1
            continue

        if result == original:
            print(f"  {rel}  ->  already current")
            unchanged += 1
            continue

        print(f"  {rel}  ->  {note}")
        changed += 1

        if args.apply:
            backup = page.with_suffix(page.suffix + f".{stamp}.bak")
            shutil.copy2(page, backup)
            page.write_text(result, encoding="utf-8")

    mode = "APPLIED" if args.apply else "DRY RUN (no files written)"
    print(f"\n{mode}: {changed} to change, {unchanged} already current, {skipped} skipped")
    if changed and not args.apply:
        print("Re-run with --apply to write. Backups get a .{timestamp}.bak suffix.")


if __name__ == "__main__":
    main()
