import re

def generate_grid_rooms(floor_num, prefix):
    rooms = []
    # 西翼 (X:0~10500) 8分割部屋
    west_rooms = [
        ("18", "実験室18", "lab", 0, 0, 10500, 6000),
        ("17", "研究室17", "research", 0, 6000, 10500, 6000),
        ("16", "実験室16", "lab", 0, 12000, 10500, 6000),
        ("15", "実験室15", "lab", 0, 18000, 10500, 6000),
        ("14", "研究室14", "research", 0, 24000, 10500, 6000),
        ("13", "実験室13", "lab", 0, 30000, 10500, 6000),
        ("12", "研究室12", "research", 0, 36000, 10500, 6000),
        ("11", "実験室11", "lab", 0, 42000, 10500, 12000),
    ]
    
    for r_no, r_name, r_type, x, y, w, h in west_rooms:
        full_no = f"{prefix}{r_no}"
        rooms.append(f'      {{ id: "{full_no}", roomNo: "{full_no}", name: "{f"{prefix}F "} {r_name}", type: "{r_type}", x: {x}, y: {y}, w: {w}, h: {h} }}')

    # 西コア・縦廊下 (X:10500~19200)
    rooms.append(f'      {{ id: "WC-W{prefix}F", roomNo: "WC-W", name: "西階段・WCコア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 }}')
    rooms.append(f'      {{ id: "COR-W{prefix}F", roomNo: "COR-W", name: "西縦廊下", type: "corridor", x: 10500, y: 4800, w: 8700, h: 44200 }}')
    rooms.append(f'      {{ id: "WC-WN{prefix}F", roomNo: "WC-WN", name: "西北階段コア", type: "stair_elv", x: 10500, y: 49000, w: 8700, h: 5000 }}')

    # 中央小割部屋グリッド (X:19200~29200) - 各4.5m/5m/6m の小区画研究室
    # 左側 (x:19200, w:4600) 10部屋
    for i in range(10):
        y_pos = 9600 + i * 2800
        r_num = 31 - i
        rooms.append(f'      {{ id: "{prefix}{r_num}", roomNo: "{prefix}{r_num}", name: "{prefix}{r_num}研究室", type: "research", x: 19200, y: {y_pos}, w: 4600, h: 2800 }}')
    
    # 中央吹き抜け/中庭 (x:23800, w:800)
    rooms.append(f'      {{ id: "VOID-{prefix}F", roomNo: "VOID", name: "中央吹抜", type: "void", x: 23800, y: 9600, w: 800, h: 28000 }}')

    # 右側 (x:24600, w:4600) 10部屋
    for i in range(10):
        y_pos = 9600 + i * 2800
        r_num = 21 + i
        rooms.append(f'      {{ id: "{prefix}{r_num}", roomNo: "{prefix}{r_num}", name: "{prefix}{r_num}研究室", type: "research", x: 24600, y: {y_pos}, w: 4600, h: 2800 }}')

    # 東コア・縦廊下 (X:29200~37900)
    rooms.append(f'      {{ id: "WC-E{prefix}F", roomNo: "WC-E", name: "東階段・EV・WCコア", type: "stair_elv", x: 29200, y: 0, w: 8700, h: 4800 }}')
    rooms.append(f'      {{ id: "COR-E{prefix}F", roomNo: "COR-E", name: "東縦廊下", type: "corridor", x: 29200, y: 4800, w: 8700, h: 44200 }}')
    rooms.append(f'      {{ id: "WC-EN{prefix}F", roomNo: "WC-EN", name: "東北階段コア", type: "stair_elv", x: 29200, y: 49000, w: 8700, h: 5000 }}')

    # 東翼 (X:37900~48400) 8分割部屋
    east_rooms = [
        ("01", "実験室01", "lab", 37900, 0, 10500, 6000),
        ("02", "研究室02", "research", 37900, 6000, 10500, 6000),
        ("03", "実験室03", "lab", 37900, 12000, 10500, 6000),
        ("04", "実験室04", "lab", 37900, 18000, 10500, 6000),
        ("05", "研究室05", "research", 37900, 24000, 10500, 6000),
        ("06", "実験室06", "lab", 37900, 30000, 10500, 6000),
        ("07", "研究室07", "research", 37900, 36000, 10500, 6000),
        ("08", "実験室08", "lab", 37900, 42000, 10500, 12000),
    ]

    for r_no, r_name, r_type, x, y, w, h in east_rooms:
        full_no = f"{prefix}{r_no}"
        rooms.append(f'      {{ id: "{full_no}", roomNo: "{full_no}", name: "{prefix}F {r_name}", type: "{r_type}", x: {x}, y: {y}, w: {w}, h: {h} }}')

    return ",\n".join(rooms)

print("4F Rooms generated sample:")
print(generate_grid_rooms(4, 4)[:500])
