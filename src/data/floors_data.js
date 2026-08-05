/**
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
// ================= 1F 平面図 =================
{
floor: 1,
name: "1階 平面図",
shortName: "1F",
shearWalls: [
{ x: 10500, y: 0, width: 600, height: 54000 },
{ x: 37300, y: 0, width: 600, height: 54000 }
],
rooms: [
// 西翼 (X1:0 ~ X2:10500)
{ id: "101", roomNo: "116", name: "保健室", type: "office", x: 0, y: 0, w: 10500, h: 4800 },
{ id: "102", roomNo: "115", name: "事務準備室", type: "research", x: 0, y: 4800, w: 10500, h: 4800 },
{ id: "103", roomNo: "114", name: "教務主事室", type: "research", x: 0, y: 9600, w: 10500, h: 5400 },
{ id: "104", roomNo: "113", name: "納品倉庫", type: "core", x: 0, y: 15000, w: 10500, h: 6000 },
{ id: "105", roomNo: "112", name: "電気室", type: "core", x: 0, y: 21000, w: 10500, h: 12000 },
{ id: "106", roomNo: "111", name: "自家発電機室", type: "core", x: 0, y: 33000, w: 10500, h: 11000 },
{ id: "107", roomNo: "110", name: "受水槽・消火ポンプ室", type: "core", x: 0, y: 44000, w: 10500, h: 10000 },

// 西縦コア＆廊下 (X2:10500 ~ X3:19200)
{ id: "108", roomNo: "WC-W1", name: "西1F男子/女子トイレ・階段コア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 },
{ id: "109", roomNo: "120", name: "西1Fサブ防災倉庫", type: "core", x: 10500, y: 4800, w: 8700, h: 4800 },
{ id: "110", roomNo: "COR-1W", name: "西縦廊下 (廊下1)", type: "corridor", x: 10500, y: 9600, w: 8700, h: 23400 },
{ id: "111", roomNo: "119", name: "大講義室1 (階下部)", type: "classroom", x: 10500, y: 33000, w: 8700, h: 11000 },
{ id: "112", roomNo: "WC-W2", name: "多目的トイレ・北階段コア", type: "stair_elv", x: 10500, y: 44000, w: 8700, h: 10000 },

// 中央エリア (X3:19200 ~ X5:29200)
{ id: "113", roomNo: "ENT", name: "主出入口・風除室・エントランスホール", type: "corridor", x: 19200, y: 0, w: 10000, h: 4800 },
{ id: "114", roomNo: "COR-1C", name: "中央南廊下4", type: "corridor", x: 19200, y: 4800, w: 10000, h: 4800 },
{ id: "115", roomNo: "117-G", name: "中庭 (中央光庭吹抜)", type: "void", x: 19200, y: 9600, w: 5000, h: 11400 },
{ id: "116", roomNo: "117", name: "音楽室・奏鳴ラ活動室", type: "lab", x: 24200, y: 9600, w: 5000, h: 11400 },
{ id: "117", roomNo: "118-M", name: "楽器庫", type: "core", x: 19200, y: 21000, w: 10000, h: 12000 },
{ id: "118", roomNo: "118", name: "大講義室2 (階段教室)", type: "classroom", x: 19200, y: 33000, w: 10000, h: 11000 },
{ id: "119", roomNo: "HALL-N", name: "北ホール・風除室", type: "corridor", x: 19200, y: 44000, w: 10000, h: 10000 },

// 東縦コア＆廊下 (X5:29200 ~ X6:37900)
{ id: "120", roomNo: "WC-E1", name: "東1F階段・EV・WCコア", type: "stair_elv", x: 29200, y: 0, w: 8700, h: 4800 },
{ id: "121", roomNo: "COR-1E", name: "東縦廊下 (廊下2)", type: "corridor", x: 29200, y: 4800, w: 8700, h: 39200 },
{ id: "122", roomNo: "WC-E2", name: "東多目的トイレ・北東階段コア", type: "stair_elv", x: 29200, y: 44000, w: 8700, h: 10000 },

// 東翼 (X6:37900 ~ X7:48400)
{ id: "123", roomNo: "101", name: "事務倉庫", type: "core", x: 37900, y: 0, w: 5250, h: 4800 },
{ id: "124", roomNo: "102", name: "備品室", type: "core", x: 43150, y: 0, w: 5250, h: 4800 },
{ id: "125", roomNo: "103", name: "学務課事務室", type: "research", x: 37900, y: 4800, w: 10500, h: 4800 },
{ id: "126", roomNo: "104", name: "教務主事室・兼教育用品倉庫", type: "research", x: 37900, y: 9600, w: 10500, h: 5400 },
{ id: "127", roomNo: "105", name: "会議室", type: "research", x: 37900, y: 15000, w: 10500, h: 6000 },
{ id: "128", roomNo: "106", name: "校長室", type: "research", x: 37900, y: 21000, w: 10500, h: 6000 },
{ id: "129", roomNo: "107", name: "学生主事室", type: "research", x: 37900, y: 27000, w: 10500, h: 6000 },
{ id: "130", roomNo: "108", name: "寮務主事室", type: "research", x: 37900, y: 33000, w: 10500, h: 6000 },
{ id: "131", roomNo: "109", name: "女性更衣室", type: "office", x: 37900, y: 39000, w: 10500, h: 15000 }
]
},

// ================= 2F 平面図 =================
{
floor: 2,
name: "2階 平面図",
shortName: "2F",
shearWalls: [
{ x: 10500, y: 0, width: 600, height: 54000 },
{ x: 37300, y: 0, width: 600, height: 54000 }
],
rooms: [
// 西翼 (X1:0 ~ X2:10500)
{ id: "201", roomNo: "216", name: "情報演習室1", type: "classroom", x: 0, y: 0, w: 10500, h: 9600 },
{ id: "202", roomNo: "215", name: "情報演習室2", type: "classroom", x: 0, y: 9600, w: 10500, h: 11400 },
{ id: "203", roomNo: "214", name: "情報サーバー室", type: "core", x: 0, y: 21000, w: 10500, h: 6000 },
{ id: "204", roomNo: "213", name: "CAD/CAM演習室", type: "classroom", x: 0, y: 27000, w: 10500, h: 12000 },
{ id: "205", roomNo: "212", name: "物理演習室", type: "classroom", x: 0, y: 39000, w: 10500, h: 15000 },

// 西縦コア＆廊下 (X2:10500 ~ X3:19200)
{ id: "206", roomNo: "WC-W2F", name: "西2F階段・EV・WCコア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 },
{ id: "207", roomNo: "COR-2W", name: "西縦廊下 (廊下1)", type: "corridor", x: 10500, y: 4800, w: 8700, h: 44200 },
{ id: "208", roomNo: "WC-WN2F", name: "西2F北階段コア", type: "stair_elv", x: 10500, y: 49000, w: 8700, h: 5000 },

// 中央エリア (X3:19200 ~ X5:29200)
{ id: "209", roomNo: "COR-2S", name: "2F南連絡廊下", type: "corridor", x: 19200, y: 0, w: 10000, h: 4800 },
{ id: "210", roomNo: "217-V", name: "中庭上部 (吹き抜け)", type: "void", x: 19200, y: 4800, w: 10000, h: 16200 },
{ id: "211", roomNo: "218-G", name: "屋上庭園・テラス", type: "garden", x: 19200, y: 21000, w: 10000, h: 12000 },
{ id: "212", roomNo: "218", name: "大講義室2 (上部吹き抜け)", type: "void", x: 19200, y: 33000, w: 10000, h: 11000 },
{ id: "213", roomNo: "COR-2N", name: "2F北連絡廊下", type: "corridor", x: 19200, y: 44000, w: 10000, h: 10000 },

// 東縦コア＆廊下 (X5:29200 ~ X6:37900)
{ id: "214", roomNo: "WC-E2F", name: "東2F階段・EV・WCコア", type: "stair_elv", x: 29200, y: 0, w: 8700, h: 4800 },
{ id: "215", roomNo: "COR-2E", name: "東縦廊下 (廊下2)", type: "corridor", x: 29200, y: 4800, w: 8700, h: 44200 },
{ id: "216", roomNo: "WC-EN2F", name: "東2F北階段コア", type: "stair_elv", x: 29200, y: 49000, w: 8700, h: 5000 },

// 東翼 (X6:37900 ~ X7:48400)
{ id: "217", roomNo: "201", name: "201演習室", type: "classroom", x: 37900, y: 0, w: 10500, h: 4800 },
{ id: "218", roomNo: "202", name: "202演習室", type: "classroom", x: 37900, y: 4800, w: 10500, h: 4800 },
{ id: "219", roomNo: "203", name: "203演習室", type: "classroom", x: 37900, y: 9600, w: 10500, h: 5400 },
{ id: "220", roomNo: "204", name: "204演習室", type: "classroom", x: 37900, y: 15000, w: 10500, h: 6000 },
{ id: "221", roomNo: "205", name: "205演習室", type: "classroom", x: 37900, y: 21000, w: 10500, h: 6000 },
{ id: "222", roomNo: "206", name: "206演習室", type: "classroom", x: 37900, y: 27000, w: 10500, h: 6000 },
{ id: "223", roomNo: "207", name: "207演習室", type: "classroom", x: 37900, y: 33000, w: 10500, h: 6000 },
{ id: "224", roomNo: "208", name: "208演習室", type: "classroom", x: 37900, y: 39000, w: 10500, h: 5000 },
{ id: "225", roomNo: "209", name: "209演習室", type: "classroom", x: 37900, y: 44000, w: 10500, h: 10000 }
]
},

// ================= 3F 平面図 =================
{
floor: 3,
name: "3階 平面図",
shortName: "3F",
shearWalls: [
{ x: 10500, y: 0, width: 600, height: 54000 },
{ x: 37300, y: 0, width: 600, height: 54000 }
],
rooms: [
// 西翼 (X1:0 ~ X2:10500)
{ id: "301", roomNo: "318", name: "電子回路実験室", type: "lab", x: 0, y: 0, w: 10500, h: 9600 },
{ id: "302", roomNo: "317", name: "電子実験準備室", type: "research", x: 0, y: 9600, w: 10500, h: 5400 },
{ id: "303", roomNo: "316", name: "応用専門PBL実験室1", type: "lab", x: 0, y: 15000, w: 10500, h: 12000 },
{ id: "304", roomNo: "315", name: "L1実験室", type: "lab", x: 0, y: 27000, w: 10500, h: 12000 },
{ id: "305", roomNo: "314", name: "研究室9", type: "research", x: 0, y: 39000, w: 10500, h: 5000 },
{ id: "306", roomNo: "313", name: "K1実験室", type: "lab", x: 0, y: 44000, w: 10500, h: 10000 },

// 西縦コア＆廊下 (X2:10500 ~ X3:19200)
{ id: "307", roomNo: "WC-W3F", name: "西3F階段・EV・WCコア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 },
{ id: "308", roomNo: "COR-3W", name: "西縦廊下 (廊下1)", type: "corridor", x: 10500, y: 4800, w: 8700, h: 44200 },
{ id: "309", roomNo: "WC-WN3F", name: "西3F北階段コア", type: "stair_elv", x: 10500, y: 49000, w: 8700, h: 5000 },

// 中央エリア (X3:19200 ~ X5:29200)
{ id: "310", roomNo: "320-V", name: "吹抜 (南階段前)", type: "void", x: 19200, y: 0, w: 10000, h: 4800 },
{ id: "311", roomNo: "COR-3S", name: "廊下4", type: "corridor", x: 19200, y: 4800, w: 10000, h: 4800 },
{ id: "312", roomNo: "328", name: "W1実験室", type: "lab", x: 19200, y: 9600, w: 10000, h: 5400 },
{ id: "313", roomNo: "327", name: "W2実験室", type: "lab", x: 19200, y: 15000, w: 5000, h: 12000 },
{ id: "314", roomNo: "317-V", name: "中庭上部 (巨大吹き抜け)", type: "void", x: 24200, y: 15000, w: 1000, h: 24000 },
{ id: "315", roomNo: "321", name: "物理計測実験室", type: "lab", x: 25200, y: 15000, w: 4000, h: 12000 },
{ id: "316", roomNo: "322", name: "322研究室", type: "research", x: 19200, y: 27000, w: 5000, h: 3000 },
{ id: "317", roomNo: "323", name: "323研究室", type: "research", x: 19200, y: 30000, w: 5000, h: 3000 },
{ id: "318", roomNo: "324", name: "324研究室", type: "research", x: 19200, y: 33000, w: 5000, h: 3000 },
{ id: "319", roomNo: "325", name: "325研究室", type: "research", x: 19200, y: 36000, w: 5000, h: 3000 },
{ id: "320", roomNo: "326", name: "326研究室", type: "research", x: 19200, y: 39000, w: 5000, h: 5000 },
{ id: "321", roomNo: "COR-3N", name: "廊下3", type: "corridor", x: 19200, y: 44000, w: 10000, h: 5000 },
{ id: "322", roomNo: "311-V", name: "非常勤講師控室・女子更衣室・吹抜", type: "void", x: 19200, y: 49000, w: 10000, h: 5000 },

// 東縦コア＆廊下 (X5:29200 ~ X6:37900)
{ id: "323", roomNo: "WC-E3F", name: "東3F階段・EV・WCコア", type: "stair_elv", x: 29200, y: 0, w: 8700, h: 4800 },
{ id: "324", roomNo: "COR-3E", name: "東縦廊下 (廊下2)", type: "corridor", x: 29200, y: 4800, w: 8700, h: 44200 },
{ id: "325", roomNo: "WC-EN3F", name: "東3F北階段コア", type: "stair_elv", x: 29200, y: 49000, w: 8700, h: 5000 },

// 東翼 (X6:37900 ~ X7:48400)
{ id: "326", roomNo: "301", name: "D1実験室", type: "lab", x: 37900, y: 0, w: 5250, h: 4800 },
{ id: "327", roomNo: "302", name: "P1実験室", type: "lab", x: 43150, y: 0, w: 5250, h: 4800 },
{ id: "328", roomNo: "303", name: "分析室1", type: "lab", x: 37900, y: 4800, w: 10500, h: 4800 },
{ id: "329", roomNo: "304", name: "薬品保管室", type: "core", x: 37900, y: 9600, w: 10500, h: 5400 },
{ id: "330", roomNo: "305", name: "305研究室", type: "research", x: 37900, y: 15000, w: 10500, h: 6000 },
{ id: "331", roomNo: "306", name: "E1実験室", type: "lab", x: 37900, y: 21000, w: 10500, h: 6000 },
{ id: "332", roomNo: "307", name: "M4実験室", type: "lab", x: 37900, y: 27000, w: 10500, h: 6000 },
{ id: "333", roomNo: "308", name: "E2実験室", type: "lab", x: 37900, y: 33000, w: 10500, h: 6000 },
{ id: "334", roomNo: "309", name: "E3実験室", type: "lab", x: 37900, y: 39000, w: 10500, h: 5000 },
{ id: "335", roomNo: "310", name: "E4実験室", type: "lab", x: 37900, y: 44000, w: 10500, h: 10000 }
]
},

// ================= 4F 平面図 =================
{
floor: 4,
name: "4階 平面図",
shortName: "4F",
shearWalls: [
{ x: 10500, y: 0, width: 600, height: 54000 },
{ x: 37300, y: 0, width: 600, height: 54000 }
],
rooms: [
// 西翼 (X1:0 ~ X2:10500)
{ id: "401", roomNo: "418", name: "化学実験室", type: "lab", x: 0, y: 0, w: 10500, h: 9600 },
{ id: "402", roomNo: "417", name: "化学準備室", type: "research", x: 0, y: 9600, w: 10500, h: 5400 },
{ id: "403", roomNo: "416", name: "卒研事業 応用専門PBL実験室3", type: "lab", x: 0, y: 15000, w: 10500, h: 12000 },
{ id: "404", roomNo: "415", name: "M2実験室", type: "lab", x: 0, y: 27000, w: 10500, h: 12000 },
{ id: "405", roomNo: "414", name: "研究室10", type: "research", x: 0, y: 39000, w: 10500, h: 5000 },
{ id: "406", roomNo: "413", name: "N1実験室", type: "lab", x: 0, y: 44000, w: 10500, h: 10000 },

// 西縦コア＆廊下 (X2:10500 ~ X3:19200)
{ id: "407", roomNo: "WC-W4F", name: "西4F階段・EV・WCコア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 },
{ id: "408", roomNo: "COR-4W", name: "西縦廊下 (廊下1)", type: "corridor", x: 10500, y: 4800, w: 8700, h: 44200 },
{ id: "409", roomNo: "WC-WN4F", name: "西4F北階段コア", type: "stair_elv", x: 10500, y: 49000, w: 8700, h: 5000 },

// 中央エリア (X3:19200 ~ X5:29200)
{ id: "410", roomNo: "419", name: "419研究室", type: "research", x: 19200, y: 0, w: 5000, h: 4800 },
{ id: "410", roomNo: "419", name: "419研究室", type: "research", x: 19200, y: 0, w: 5000, h: 4800 },
{ id: "411", roomNo: "420", name: "420研究室", type: "research", x: 24200, y: 0, w: 5000, h: 4800 },
{ id: "412", roomNo: "COR-4S", name: "廊下4", type: "corridor", x: 19200, y: 4800, w: 10000, h: 4800 },
{ id: "413", roomNo: "431", name: "431研究室", type: "research", x: 19200, y: 9600, w: 5000, h: 3000 },
{ id: "414", roomNo: "430", name: "430研究室", type: "research", x: 19200, y: 12600, w: 5000, h: 3000 },
{ id: "415", roomNo: "429", name: "429研究室", type: "research", x: 19200, y: 15600, w: 5000, h: 3400 },
{ id: "416", roomNo: "428", name: "W3実験室", type: "lab", x: 19200, y: 19000, w: 10000, h: 8000 },
{ id: "417", roomNo: "427", name: "卒研事業 応用専門PBL実験室2", type: "lab", x: 19200, y: 27000, w: 4500, h: 12000 },
{ id: "418", roomNo: "417-V", name: "中庭上部 (吹き抜け)", type: "void", x: 23700, y: 27000, w: 1000, h: 12000 },
{ id: "419", roomNo: "421", name: "物理実験室", type: "lab", x: 24700, y: 27000, w: 4500, h: 12000 },
{ id: "420", roomNo: "422", name: "422研究室", type: "research", x: 24200, y: 39000, w: 5000, h: 2000 },
{ id: "421", roomNo: "423", name: "423研究室", type: "research", x: 24200, y: 41000, w: 5000, h: 2000 },
{ id: "422", roomNo: "424", name: "424研究室", type: "research", x: 24200, y: 43000, w: 5000, h: 2000 },
{ id: "423", roomNo: "425", name: "425研究室", type: "research", x: 24200, y: 45000, w: 5000, h: 2000 },
{ id: "424", roomNo: "426", name: "426研究室", type: "research", x: 24200, y: 47000, w: 5000, h: 2000 },
{ id: "425", roomNo: "COR-4N", name: "廊下3", type: "corridor", x: 19200, y: 39000, w: 5000, h: 10000 },
{ id: "426", roomNo: "411", name: "非常勤講師控室", type: "office", x: 19200, y: 49000, w: 5000, h: 5000 },
{ id: "427", roomNo: "412", name: "女子更衣室", type: "office", x: 24200, y: 49000, w: 5000, h: 5000 }
]
},

// ================= 5F 平面図 =================
{
floor: 5,
name: "5階 平面図",
shortName: "5F",
shearWalls: [
{ x: 10500, y: 0, width: 600, height: 54000 },
{ x: 37300, y: 0, width: 600, height: 54000 }
],
rooms: [
// 西翼 (X1:0 ~ X2:10500)
{ id: "501", roomNo: "518", name: "518高学年実験室", type: "lab", x: 0, y: 0, w: 10500, h: 9600 },
{ id: "502", roomNo: "517", name: "517研究室", type: "research", x: 0, y: 9600, w: 10500, h: 5400 },
{ id: "503", roomNo: "516", name: "516高学年実験室", type: "lab", x: 0, y: 15000, w: 10500, h: 12000 },
{ id: "504", roomNo: "515", name: "515高学年実験室", type: "lab", x: 0, y: 27000, w: 10500, h: 12000 },
{ id: "505", roomNo: "514", name: "514研究室", type: "research", x: 0, y: 39000, w: 10500, h: 5000 },
{ id: "506", roomNo: "513", name: "513高学年実験室", type: "lab", x: 0, y: 44000, w: 10500, h: 10000 },

// 西縦コア＆廊下 (X2:10500 ~ X3:19200)
{ id: "507", roomNo: "WC-W5F", name: "西5F階段・EV・WCコア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 },
{ id: "508", roomNo: "COR-5W", name: "西縦廊下 (廊下1)", type: "corridor", x: 10500, y: 4800, w: 8700, h: 44200 },
{ id: "509", roomNo: "WC-WN5F", name: "西5F北階段コア", type: "stair_elv", x: 10500, y: 49000, w: 8700, h: 5000 },

// 中央エリア (X3:19200 ~ X5:29200)
{ id: "510", roomNo: "519", name: "519研究室", type: "research", x: 19200, y: 0, w: 5000, h: 4800 },
{ id: "511", roomNo: "520", name: "520研究室", type: "research", x: 24200, y: 0, w: 5000, h: 4800 },
{ id: "512", roomNo: "COR-5S", name: "廊下4", type: "corridor", x: 19200, y: 4800, w: 10000, h: 4800 },
{ id: "513", roomNo: "528", name: "528中央実験室", type: "lab", x: 19200, y: 9600, w: 10000, h: 17400 },
{ id: "514", roomNo: "517-V5", name: "中央吹き抜け", type: "void", x: 19200, y: 27000, w: 10000, h: 12000 },
{ id: "515", roomNo: "COR-5N", name: "廊下3", type: "corridor", x: 19200, y: 39000, w: 10000, h: 10000 },
{ id: "516", roomNo: "511", name: "511研究室", type: "research", x: 19200, y: 49000, w: 5000, h: 5000 },
{ id: "517", roomNo: "512", name: "512研究室", type: "research", x: 24200, y: 49000, w: 5000, h: 5000 },

// 東縦コア＆廊下 (X5:29200 ~ X6:37900)
{ id: "518", roomNo: "WC-E5F", name: "東5F階段・EV・WCコア", type: "stair_elv", x: 29200, y: 0, w: 8700, h: 4800 },
{ id: "519", roomNo: "COR-5E", name: "東縦廊下 (廊下2)", type: "corridor", x: 29200, y: 4800, w: 8700, h: 44200 },
{ id: "520", roomNo: "WC-EN5F", name: "東5F北階段コア", type: "stair_elv", x: 29200, y: 49000, w: 8700, h: 5000 },

// 東翼 (X6:37900 ~ X7:48400)
{ id: "521", roomNo: "501", name: "501高学年実験室", type: "lab", x: 37900, y: 0, w: 10500, h: 9600 },
{ id: "522", roomNo: "503", name: "503研究室", type: "research", x: 37900, y: 9600, w: 10500, h: 5400 },
{ id: "523", roomNo: "504", name: "504高学年実験室", type: "lab", x: 37900, y: 15000, w: 10500, h: 12000 },
{ id: "524", roomNo: "506", name: "506高学年実験室", type: "lab", x: 37900, y: 27000, w: 10500, h: 12000 },
{ id: "525", roomNo: "509", name: "509研究室", type: "research", x: 37900, y: 39000, w: 10500, h: 5000 },
{ id: "526", roomNo: "510", name: "510高学年実験室", type: "lab", x: 37900, y: 44000, w: 10500, h: 10000 }
]
},

// ================= 6F 平面図 =================
{
floor: 6,
name: "6階 平面図",
shortName: "6F",
shearWalls: [
{ x: 10500, y: 0, width: 600, height: 54000 },
{ x: 37300, y: 0, width: 600, height: 54000 }
],
rooms: [
// 西翼 (X1:0 ~ X2:10500)
{ id: "601", roomNo: "618", name: "618卒業研究室", type: "lab", x: 0, y: 0, w: 10500, h: 9600 },
{ id: "602", roomNo: "617", name: "617研究室", type: "research", x: 0, y: 9600, w: 10500, h: 5400 },
{ id: "603", roomNo: "616", name: "616卒業研究室", type: "lab", x: 0, y: 15000, w: 10500, h: 12000 },
{ id: "604", roomNo: "615", name: "615卒業研究室", type: "lab", x: 0, y: 27000, w: 10500, h: 12000 },
{ id: "605", roomNo: "614", name: "614研究室", type: "research", x: 0, y: 39000, w: 10500, h: 5000 },
{ id: "606", roomNo: "613", name: "613卒業研究室", type: "lab", x: 0, y: 44000, w: 10500, h: 10000 },

// 西縦コア＆廊下 (X2:10500 ~ X3:19200)
{ id: "607", roomNo: "WC-W6F", name: "西6F階段・EV・WCコア", type: "stair_elv", x: 10500, y: 0, w: 8700, h: 4800 },
{ id: "608", roomNo: "COR-6W", name: "西縦廊下 (廊下1)", type: "corridor", x: 10500, y: 4800, w: 8700, h: 44200 },
{ id: "609", roomNo: "WC-WN6F", name: "西6F北階段コア", type: "stair_elv", x: 10500, y: 49000, w: 8700, h: 5000 },

// 中央エリア (X3:19200 ~ X5:29200)
{ id: "610", roomNo: "619-V", name: "南吹抜・ラウンジ", type: "void", x: 19200, y: 0, w: 10000, h: 9600 },
{ id: "611", roomNo: "COR-6S", name: "廊下4", type: "corridor", x: 19200, y: 9600, w: 10000, h: 5400 },
{ id: "612", roomNo: "628", name: "628特別研究室", type: "lab", x: 19200, y: 15000, w: 10000, h: 12000 },
{ id: "613", roomNo: "617-V6", name: "中央吹抜", type: "void", x: 19200, y: 27000, w: 10000, h: 12000 },
{ id: "614", roomNo: "COR-6N", name: "廊下3", type: "corridor", x: 19200, y: 39000, w: 10000, h: 10000 },
{ id: "615", roomNo: "611", name: "611研究室", type: "research", x: 19200, y: 49000, w: 5000, h: 5000 },
{ id: "616", roomNo: "612", name: "612研究室", type: "research", x: 24200, y: 49000, w: 5000, h: 5000 },

// 東縦コア＆廊下 (X5:29200 ~ X6:37900)
{ id: "617", roomNo: "WC-E6F", name: "東6F階段・EV・WCコア", type: "stair_elv", x: 29200, y: 0, w: 8700, h: 4800 },
{ id: "618", roomNo: "COR-6E", name: "東縦廊下 (廊下2)", type: "corridor", x: 29200, y: 4800, w: 8700, h: 44200 },
{ id: "619", roomNo: "WC-EN6F", name: "東6F北階段コア", type: "stair_elv", x: 29200, y: 49000, w: 8700, h: 5000 },

// 東翼 (X6:37900 ~ X7:48400)
{ id: "620", roomNo: "601", name: "601卒業研究室", type: "lab", x: 37900, y: 0, w: 10500, h: 9600 },
{ id: "621", roomNo: "603", name: "603研究室", type: "research", x: 37900, y: 9600, w: 10500, h: 5400 },
{ id: "622", roomNo: "604", name: "604卒業研究室", type: "lab", x: 37900, y: 15000, w: 10500, h: 12000 },
{ id: "623", roomNo: "606", name: "606卒業研究室", type: "lab", x: 37900, y: 27000, w: 10500, h: 12000 },
{ id: "624", roomNo: "609", name: "609研究室", type: "research", x: 37900, y: 39000, w: 10500, h: 5000 },
{ id: "625", roomNo: "610", name: "610卒業研究室", type: "lab", x: 37900, y: 44000, w: 10500, h: 10000 }
]
}
];
