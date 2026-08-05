import json
import re

with open('C:/Users/hirabayashi/.gemini/antigravity-ide/brain/42295bd9-6cbf-4714-8e39-bd015f39b41d/.system_generated/logs/transcript_full.jsonl', 'r', encoding='utf-8') as f:
    lines = f.readlines()

blocks = []
for line in lines:
    if 'floors_data.js`' in line:
        data = json.loads(line)
        content = data.get('content', '')
        raw_lines = content.split('\n')
        clean_lines = []
        for rl in raw_lines:
            m = re.match(r'^\s*\d+:\s*(.*)', rl)
            if m:
                clean_lines.append(m.group(1))
        if clean_lines:
            blocks.append(clean_lines)

print('Found blocks count:', len(blocks))
for idx, b in enumerate(blocks):
    print(f'Block {idx}: first line = "{b[0][:50]}", total lines = {len(b)}')

if len(blocks) >= 2:
    full_lines = blocks[0] + blocks[1]
    with open('src/data/floors_data.js', 'w', encoding='utf-8') as out:
        out.write('\n'.join(full_lines))
    print('Successfully combined and restored full floors_data.js!')
