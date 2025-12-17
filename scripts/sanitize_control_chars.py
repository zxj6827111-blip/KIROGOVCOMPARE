#!/usr/bin/env python3
"""
Utility script to scan and optionally clean hidden/bidi Unicode control characters.
"""
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List, Set, Tuple

CONTROL_CHARS_PATTERN = re.compile(r"[\uFEFF\u200B-\u200F\u202A-\u202E\u2066-\u2069]")
DEFAULT_EXCLUDE_DIRS = {".git", "node_modules", "dist", "build", ".next", "coverage"}
DEFAULT_EXTENSIONS = {".ts", ".tsx", ".js", ".json", ".md", ".yml", ".yaml", ".sh", ".py", ".sql", ".txt"}


class ControlCharIssue:
    def __init__(self, path: Path, line_no: int, preview: str):
        self.path = path
        self.line_no = line_no
        self.preview = preview

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.path}:{self.line_no}: {self.preview}"


def list_staged_files() -> List[Path]:
    try:
        output = subprocess.check_output([
            "git",
            "diff",
            "--cached",
            "--name-only",
        ], text=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("Failed to list staged files") from exc

    files = []
    for line in output.splitlines():
        candidate = Path(line.strip())
        if candidate.exists():
            files.append(candidate)
    return files


def should_skip(path: Path, exclude_dirs: Set[str], allowed_exts: Set[str]) -> bool:
    parts = set(path.parts)
    if parts & exclude_dirs:
        return True
    if path.is_dir():
        return True
    return path.suffix not in allowed_exts


def iter_files(paths: Iterable[Path], exclude_dirs: Set[str], allowed_exts: Set[str]) -> Iterable[Path]:
    for root_path in paths:
        if root_path.is_file():
            if not should_skip(root_path, exclude_dirs, allowed_exts):
                yield root_path
            continue
        for current_root, dirnames, filenames in os.walk(root_path):
            dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
            for filename in filenames:
                candidate = Path(current_root, filename)
                if should_skip(candidate, exclude_dirs, allowed_exts):
                    continue
                yield candidate


def find_issues(path: Path) -> List[ControlCharIssue]:
    issues: List[ControlCharIssue] = []
    try:
        with path.open("r", encoding="utf-8") as f:
            for idx, line in enumerate(f, start=1):
                if CONTROL_CHARS_PATTERN.search(line):
                    preview = line.rstrip("\n")
                    issues.append(ControlCharIssue(path, idx, preview))
    except UnicodeDecodeError:
        return issues
    return issues


def clean_file(path: Path) -> bool:
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False

    cleaned = CONTROL_CHARS_PATTERN.sub("", content)
    if cleaned != content:
        path.write_text(cleaned, encoding="utf-8")
        return True
    return False


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan and clean hidden/bidi Unicode control characters")
    action_group = parser.add_mutually_exclusive_group(required=True)
    action_group.add_argument("--check", action="store_true", help="Scan and report findings; exit 1 if found")
    action_group.add_argument("--write", action="store_true", help="Remove control characters in-place")
    parser.add_argument("paths", nargs="*", default=["."], help="Files or directories to scan")
    parser.add_argument("--staged", action="store_true", help="Only scan staged files")
    parser.add_argument(
        "--extensions",
        nargs="*",
        default=sorted(DEFAULT_EXTENSIONS),
        help="File extensions to include (default: common text/code)",
    )
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=sorted(DEFAULT_EXCLUDE_DIRS),
        help="Directories to exclude",
    )
    return parser.parse_args(argv)


def run_scan(target_files: Iterable[Path], check_only: bool) -> Tuple[int, List[ControlCharIssue]]:
    findings: List[ControlCharIssue] = []
    cleaned_count = 0

    for file_path in target_files:
        file_issues = find_issues(file_path)
        if file_issues:
            findings.extend(file_issues)
            if not check_only:
                if clean_file(file_path):
                    cleaned_count += 1

    if not check_only and cleaned_count:
        print(f"Cleaned {cleaned_count} file(s)")

    return (1 if findings and check_only else 0), findings


def main(argv: List[str]) -> int:
    args = parse_args(argv)
    exclude_dirs = set(args.exclude)
    allowed_exts = {ext if ext.startswith(".") else f".{ext}" for ext in args.extensions}

    if args.staged:
        paths = list_staged_files()
    else:
        paths = [Path(p) for p in args.paths]

    files_to_scan = list(iter_files(paths, exclude_dirs, allowed_exts))
    exit_code, findings = run_scan(files_to_scan, check_only=args.check)

    for issue in findings:
        print(issue)

    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
