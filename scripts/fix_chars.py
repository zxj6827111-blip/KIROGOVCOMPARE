
import os

files_to_check = ['checks_result.json', '.env']

# Ranges from scripts/check_control_chars.py
CONTROL_RANGES = [
    (0xFEFF, 0xFEFF),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2066, 0x2069),
]

def clean_file(filepath):
    if not os.path.exists(filepath):
        print(f"Skipping {filepath}: not found")
        return

    print(f"Processing {filepath}...")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return

    original_len = len(content)
    new_content = ""
    removed_count = 0

    for char in content:
        code = ord(char)
        is_bad = False
        for start, end in CONTROL_RANGES:
            if start <= code <= end:
                is_bad = True
                break
        
        if not is_bad:
            new_content += char
        else:
            removed_count += 1

    if removed_count > 0:
        print(f"  Found and removed {removed_count} hidden characters.")
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
    else:
        print("  No hidden characters found.")

for f in files_to_check:
    clean_file(f)
