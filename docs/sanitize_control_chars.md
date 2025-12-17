# Hidden/Bidi Unicode sanitizer

Use `scripts/sanitize_control_chars.py` to scan for and clean hidden or bidirectional Unicode control characters (BOM, zero-width, bidi markers).

## Usage examples

- Scan the repository and exit with non-zero if any control characters are found:
  ```bash
  python3 scripts/sanitize_control_chars.py --check .
  ```
- Clean specific files in-place:
  ```bash
  python3 scripts/sanitize_control_chars.py --write <file1> <file2>
  ```
- Scan only staged files:
  ```bash
  python3 scripts/sanitize_control_chars.py --check --staged
  ```
