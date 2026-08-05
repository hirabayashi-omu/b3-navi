import re
import json

with open('decoded_floor.svg', 'r', encoding='utf-8', errors='ignore') as f:
    svg = f.read()

room_polys = re.findall(r'<rect[^>]*class="room-poly"[^>]*>', svg)
print('Total room-poly elements found:', len(room_polys))

polys_data = []
for p in room_polys:
    x0 = re.search(r'data-x0="([^"]+)"', p)
    y0 = re.search(r'data-y0="([^"]+)"', p)
    w = re.search(r'data-w="([^"]+)"', p)
    h = re.search(r'data-h="([^"]+)"', p)
    fill = re.search(r'fill="([^"]+)"', p)
    if x0 and y0 and w and h:
        polys_data.append({
            'x0': float(x0.group(1)),
            'y0': float(y0.group(1)),
            'w': float(w.group(1)),
            'h': float(h.group(1)),
            'fill': fill.group(1) if fill else ''
        })

print('Parsed polys count:', len(polys_data))

outlines = {
    1: {'x': 158.8, 'y': 452.0, 'w': 228.7, 'h': 255.1},
    2: {'x': 513.1, 'y': 452.0, 'w': 228.7, 'h': 255.1},
    3: {'x': 867.4, 'y': 452.0, 'w': 228.7, 'h': 255.1},
    4: {'x': 158.8, 'y': 103.6, 'w': 228.7, 'h': 258.5},
    5: {'x': 513.1, 'y': 103.6, 'w': 228.7, 'h': 258.5},
    6: {'x': 867.4, 'y': 103.6, 'w': 228.7, 'h': 258.5},
}

floor_polys = {f: [] for f in range(1, 7)}
for p in polys_data:
    for f, o in outlines.items():
        if o['x'] - 10 <= p['x0'] <= o['x'] + o['w'] + 10 and o['y'] - 10 <= p['y0'] <= o['y'] + o['h'] + 10:
            floor_polys[f].append(p)
            break

for f in range(1, 7):
    print(f'Floor {f} has {len(floor_polys[f])} room polygons')
