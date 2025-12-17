#!/usr/bin/env python3
import pathlib
import re
import sys

CONTROL_RANGES = [
    (0xFEFF, 0xFEFF),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2066, 0x2069),
]

def has_hidden_chars(text):
    for start, end in CONTROL_RANGES:
        for code_point in range(start, end + 1):
            char = chr(code_point)
            if char in text:
                return True
    return False

def main():
    repo_root = pathlib.Path(__file__).parent.parent
    found_any = False
    exclude_dirs = {"node_modules", "dist", "data", ".git", "build", "out", "frontend"}
    exclude_files = {".DS_Store", "package-lock.json", "yarn.lock"}

    for filepath in repo_root.rglob("*"):
        if filepath.is_dir():
            if filepath.name in exclude_dirs:
                continue
        else:
            if filepath.name in exclude_files:
                continue
            if filepath.suffix in {".jpg", ".jpeg", ".png", ".gif", ".ico", ".bin", ".pdf"}:
                continue
            if "node_modules" in filepath.parts or "dist" in filepath.parts:
                continue

            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                    if has_hidden_chars(content):
                        print(f"Found hidden control character in: {filepath.relative_to(repo_root)}")
                        found_any = True
            except Exception:
                pass

    if found_any:
        print("Error: Hidden control characters detected", file=sys.stderr)
        sys.exit(1)
    else:
        print("No hidden control characters detected.")
        sys.exit(0)

if __name__ == "__main__":
    main()
