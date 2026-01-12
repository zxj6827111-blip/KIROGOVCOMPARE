#!/usr/bin/env python3
import re
import os

# Unicode control character ranges that CI checks for
CONTROL_RANGES = [
    (0xFEFF, 0xFEFF),   # BOM
    (0x200B, 0x200F),   # Zero-width space, non-joiner, joiner, LRM, RLM
    (0x202A, 0x202E),   # Bi-directional text control: LRE, RLE, PDF, LRO, RLO
    (0x2066, 0x2069),   # Bi-directional isolates
]

def get_control_chars():
    """Return a set of all control characters to remove"""
    chars = set()
    for start, end in CONTROL_RANGES:
        for cp in range(start, end + 1):
            chars.add(chr(cp))
    return chars

def clean_file(filepath):
    """Remove hidden control characters from a file"""
    control_chars = get_control_chars()
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if any control chars exist
    found_chars = [c for c in control_chars if c in content]
    
    if found_chars:
        # Remove all control characters
        cleaned = content
        for char in control_chars:
            cleaned = cleaned.replace(char, '')
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(cleaned)
        
        print(f'✅ Cleaned: {filepath} (removed {len(found_chars)} types of control chars)')
        return True
    else:
        print(f'ℹ️ No changes: {filepath}')
        return False

def main():
    files = [
        'src/routes/jobs.ts',
        'src/routes/pdf-jobs.ts',
        'src/routes/notifications.ts',
        'src/routes/llm-comparisons.ts',
        'src/routes/users.ts',
        'src/routes/comparison-history.ts',
        'src/services/PdfExportWorker.ts'
    ]
    
    cleaned_count = 0
    for filepath in files:
        if os.path.exists(filepath):
            if clean_file(filepath):
                cleaned_count += 1
        else:
            print(f'❌ Not found: {filepath}')
    
    print(f'\n✅ Done! Cleaned {cleaned_count} files.')

if __name__ == '__main__':
    main()
