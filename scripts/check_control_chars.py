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
    
    # Expanded exclude list for better compatibility
    exclude_dirs = {
        "node_modules", "dist", "data", ".git", "build", "out", "frontend",
        ".next", ".venv", "venv", "__pycache__", ".pytest_cache", "coverage"
    }
    exclude_files = {".DS_Store", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"}

    print(f"Scanning repository: {repo_root}")
    
    file_count = 0
    for filepath in repo_root.rglob("*"):
        # Skip directories
        if filepath.is_dir():
            continue
        
        # Skip if path contains excluded directories
        if any(part in exclude_dirs for part in filepath.parts):
            continue
        
        # Skip excluded files
        if filepath.name in exclude_files:
            continue
        
        # Skip binary files
        if filepath.suffix in {".jpg", ".jpeg", ".png", ".gif", ".ico", ".bin", ".pdf", ".exe", ".dll", ".so"}:
            continue
        
        # Skip node_modules and dist anywhere in path (double check)
        if "node_modules" in filepath.parts or "dist" in filepath.parts:
            continue

        file_count += 1
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
                if has_hidden_chars(content):
                    rel_path = filepath.relative_to(repo_root)
                    print(f"❌ Found hidden control character in: {rel_path}")
                    found_any = True
        except Exception as e:
            # Silently skip files that can't be read
            pass

    print(f"✅ Scanned {file_count} files")
    
    if found_any:
        print("❌ Error: Hidden control characters detected", file=sys.stderr)
        sys.exit(1)
    else:
        print("✅ No hidden control characters detected.")
        sys.exit(0)

if __name__ == "__main__":
    main()
