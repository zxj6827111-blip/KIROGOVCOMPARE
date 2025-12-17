#!/usr/bin/env python3
import re
import sys
from pathlib import Path

CONTROL_RANGES = [
    "\ufeff",  # BOM
    *(chr(c) for c in range(0x200B, 0x2010)),  # Zero-width, bidi marks
    *(chr(c) for c in range(0x202A, 0x202F)),
    *(chr(c) for c in range(0x2066, 0x206A)),
]

SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "coverage",
    "frontend/node_modules",
    "tmp",
    "data",
}

SKIP_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".exe",
    ".dll",
}

pattern = re.compile("[" + "".join(CONTROL_RANGES) + "]")


def should_skip(path: Path) -> bool:
    parts = set(path.parts)
    if parts & SKIP_DIRS:
        return True
    if path.suffix.lower() in SKIP_EXTS:
        return True
    return False


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    offending = []

    for file_path in repo_root.rglob("*"):
        if not file_path.is_file():
            continue
        if should_skip(file_path.relative_to(repo_root)):
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        if "\x00" in content:
            continue

        if pattern.search(content):
            offending.append(file_path.relative_to(repo_root))

    if offending:
        print("Forbidden control characters found in:")
        for path in offending:
            print(f" - {path}")
        return 1

    print("No hidden control characters detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
