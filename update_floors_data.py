import re

def make_floor_rooms(prefix, floor_name):
    rooms = []
    # 西翼 (X:0~10500) 8室
    west = [
        (f"{prefix}18", "実験室18", "lab", 0, 0, 10500, 6000),
        (f"{prefix}17", "研究室17", "research", 0, 6000, 10500, 6000),
        (f"{prefix}16", "実験室16", "lab", 0, 12000, 10500, 6000),
        (f"{prefix}15", "実験室15", "lab", 0, 18000, 10500, 6000),
        (f"{prefix}14", "研究室14", "research", 0, 24000, 10500, 6000),
        (f"{prefix}13", "実験室13", "lab", 0, 30000, 10500, 6000),
        (f"{prefix}12", "研究室12", "research", 0, 36000, 10500, 6000),
        (f"{prefix}11", "実験室11", "lab", 0, 42000, 10500, 12000),
    ]

    for r_no, r_name, r_type, x, y, w, h in west:
        rooms.append(f'      {{ id: "{r_no}", roomNo: "{r_no}", name: "{r_name}", type: "{r_type}", x: {x}, y: {y}, w: {w}, h: {h} }}')

    # 西縦コア＆廊下 (X:10500~19200)
    rooms.append(f'      {{ id: "WC-W{prefix}F", roomNo: "WC-W", name: "西階段・EV・WCコア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 }}')
    rooms.append(f'      {{ id: "COR-W{prefix}F", roomNo: "COR-W", name: "西縦廊下", type: "corridor", x: 10500, y: 4800, w: 8700, h: 44200 }}')
    rooms.append(f'      {{ id: "WC-WN{prefix}F", roomNo: "WC-WN", name: "西北階段コア", type: "stair_elv", x: 10500, y: 49000, w: 8700, h: 5000 }}')

    # 中央小割研究室・実験室 (X:19200~29200, Y:9600~37600)
    # 左列 (x:19200, w:4600) 10室
    for i in range(10):
        y_pos = 9600 + i * 2800
        r_num = f"{prefix}{31-i:02d}"
        rooms.append(f'      {{ id: "{r_num}", roomNo: "{r_num}", name: "{r_num}研究室", type: "research", x: 19200, y: {y_pos}, w: 4600, h: 2800 }}')

    # 中央吹き抜け/中庭 (x:23800, w:800)
    rooms.append(f'      {{ id: "VOID-{prefix}F", roomNo: "VOID", name: "中央吹抜", type: "void", x: 23800, y: 9600, w: 800, h: 28000 }}')

    # 右列 (x:24600, w:4600) 10室
    for i in range(10):
        y_pos = 9600 + i * 2800
        r_num = f"{prefix}{21+i:02d}"
        rooms.append(f'      {{ id: "{r_num}", roomNo: "{r_num}", name: "{r_num}研究室", type: "research", x: 24600, y: {y_pos}, w: 4600, h: 2800 }}')

    # 南/北連絡廊下
    rooms.append(f'      {{ id: "COR-S{prefix}F", roomNo: "COR-S", name: "南連絡廊下", type: "corridor", x: 19200, y: 4800, w: 10000, h: 4800 }}')
    rooms.append(f'      {{ id: "COR-N{prefix}F", roomNo: "COR-N", name: "北連絡廊下", type: "corridor", x: 19200, y: 37600, w: 10000, h: 6400 }}')

    # 東縦コア＆廊下 (X:29200~37900)
    rooms.append(f'      {{ id: "WC-E{prefix}F", roomNo: "WC-E", name: "東階段・EV・WCコア", type: "stair_elv", x: 29200, y: 0, w: 8700, h: 4800 }}')
    rooms.append(f'      {{ id: "COR-E{prefix}F", roomNo: "COR-E", name: "東縦廊下", type: "corridor", x: 29200, y: 4800, w: 8700, h: 44200 }}')
    rooms.append(f'      {{ id: "WC-EN{prefix}F", roomNo: "WC-EN", name: "東北階段コア", type: "stair_elv", x: 29200, y: 49000, w: 8700, h: 5000 }}')

    # 東翼 (X:37900~48400) 8室
    east = [
        (f"{prefix}01", "実験室01", "lab", 37900, 0, 10500, 6000),
        (f"{prefix}02", "研究室02", "research", 37900, 6000, 10500, 6000),
        (f"{prefix}03", "実験室03", "lab", 37900, 12000, 10500, 6000),
        (f"{prefix}04", "実験室04", "lab", 37900, 18000, 10500, 6000),
        (f"{prefix}05", "研究室05", "research", 37900, 24000, 10500, 6000),
        (f"{prefix}06", "実験室06", "lab", 37900, 30000, 10500, 6000),
        (f"{prefix}07", "研究室07", "research", 37900, 36000, 10500, 6000),
        (f"{prefix}08", "実験室08", "lab", 37900, 42000, 10500, 12000),
    ]

    for r_no, r_name, r_type, x, y, w, h in east:
        rooms.append(f'      {{ id: "{r_no}", roomNo: "{r_no}", name: "{r_name}", type: "{r_type}", x: {x}, y: {y}, w: {w}, h: {h} }}')

    return rooms

header = '''/**
 * B3 Building Floor Data (1F - 6F)
 * 通り芯 X1~X7 (48,400mm) / Y1~Y11 (54,000mm) の完全格子幾何結合データ
 */

export const ROOM_TYPE_COLORS = {
  classroom:    { fill: 'rgba(56, 189, 248, 0.22)', stroke: '#38bdf8', name: '講義室・演習室' },
  lab:          { fill: 'rgba(16, 185, 129, 0.22)', stroke: '#10b981', name: '実験室・実習室' },
  research:     { fill: 'rgba(245, 158, 11, 0.22)', stroke: '#f59e0b', name: '研究室・事務室' },
  office:       { fill: 'rgba(168, 85, 247, 0.22)', stroke: '#a855f7', name: '控室・更衣室・トイレ' },
  core:         { fill: 'rgba(239, 68, 68, 0.22)',  stroke: '#ef4444', name: '電気室・設備室' },
  corridor:     { fill: 'rgba(148, 163, 184, 0.15)', stroke: '#64748b', name: 'ホール・廊下' },
  stair_elv:    { fill: 'rgba(236, 72, 153, 0.22)', stroke: '#ec4899', name: '階段・エレベーター' },
  void:         { fill: 'rgba(14, 165, 233, 0.35)', stroke: '#0284c7', name: '中庭・吹抜・Void' },
  garden:       { fill: 'rgba(34, 197, 94, 0.30)',  stroke: '#16a34a', name: '屋上庭園・テラス' }
};

export const FLOORS_DATA = [
'''

floors_js = []
for f in range(1, 7):
    r_list = make_floor_rooms(f, f"{f}階 平面図")
    r_str = ",\n".join(r_list)
    floor_block = f'''  {{
    floor: {f},
    name: "{f}階 平面図",
    shortName: "{f}F",
    shearWalls: [
      {{ x: 10500, y: 0, width: 600, height: 54000 }},
      {{ x: 37300, y: 0, width: 600, height: 54000 }}
    ],
    rooms: [
{r_str}
    ]
  }}'''
    floors_js.append(floor_block)

full_content = header + ",\n".join(floors_js) + "\n];\n"

with open('src/data/floors_data.js', 'w', encoding='utf-8') as out:
    out.write(full_content)

print("Successfully updated src/data/floors_data.js with exact grid room layout!")
