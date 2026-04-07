import os
import re

def is_mostly_chinese(s):
    if not s:
        return False
    chinese_chars = sum(1 for c in s if '\u4e00' <= c <= '\u9fff')
    return chinese_chars / len(s) > 0.3

def repair_text(text):
    def replace_func(match):
        bad_text = match.group(0)
        if not bad_text.strip():
            return bad_text
        try:
            # The exact corruption: original UTF-8 bytes were decoded as GBK
            good_text = bad_text.encode('gbk').decode('utf8')
            if is_mostly_chinese(good_text):
                return good_text
        except:
            pass
        return bad_text

    # Extract sequences of non-ASCII characters
    pattern = re.compile(r'[^\x00-\x7F]+')
    repaired = pattern.sub(replace_func, text)

    # Some sequences might include English/punctuation mixed in, such as "宸叉帴鏀(100%)"
    # To cover more, we could just attempt to decode everything if it throws no errors:
    try:
        entire_test = text.encode('gbk').decode('utf8')
        if entire_test != text and sum(1 for c in entire_test if '\u4e00' <= c <= '\u9fff') >= sum(1 for c in text if '\u4e00' <= c <= '\u9fff'):
            return entire_test
    except:
        pass

    return repaired

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        return 0

    repaired_content = repair_text(content)
    
    # Check if anything changed
    if content != repaired_content:
        # Write back
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(repaired_content)
        return 1
    return 0

def process_directory(directory):
    total_changed = 0
    for root, dirs, files in os.walk(directory):
        # Prevent traversing large unnecessary directories
        dirs[:] = [d for d in dirs if d not in ['.git', 'node_modules', 'dist', 'build', '.next', 'out', 'coverage', '.vscode']]

        for name in files:
            if name.endswith(('.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.md', '.env', '.example', '.css', '.scss')):
                filepath = os.path.join(root, name)
                if process_file(filepath):
                    print(f"Repaired: {filepath}")
                    total_changed += 1
    return total_changed

if __name__ == '__main__':
    print("Scanning code directories for encoding errors...")
    changed = 0
    directories = ['src', 'frontend/src', 'scripts']
    for d in directories:
        if os.path.exists(d):
            changed += process_directory(d)
    print(f"Done. Repaired {changed} files.")
