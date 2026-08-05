/**
 * B3棟 通り芯（グリッド）定義データ
 * ミリメートル (mm) 単位
 */
export const GRID_CONFIG = {
  buildingName: "大阪公立大学 中百舌鳥キャンパス B3棟",
  totalWidth: 48400, // mm (X1 ~ X7)
  totalHeight: 54000, // mm (Y1 ~ Y11)
  
  // X軸通り芯 (左から右へ)
  xGrids: [
    { id: "X1", pos: 0, label: "X1" },
    { id: "X2", pos: 10500, label: "X2" },
    { id: "X3", pos: 19200, label: "X3" },
    { id: "X5", pos: 29200, label: "X5" },
    { id: "X6", pos: 37900, label: "X6" },
    { id: "X7", pos: 48400, label: "X7" }
  ],
  
  // Y軸通り芯 (下から上へ: Y1が最南/最下)
  yGrids: [
    { id: "Y1", pos: 0, label: "Y1" },
    { id: "Y2", pos: 6000, label: "Y2" },
    { id: "Y3", pos: 9000, label: "Y3" },
    { id: "Y4", pos: 15000, label: "Y4" },
    { id: "Y5", pos: 21000, label: "Y5" },
    { id: "Y6", pos: 27000, label: "Y6" },
    { id: "Y7", pos: 33000, label: "Y7" },
    { id: "Y8", pos: 39000, label: "Y8" },
    { id: "Y9", pos: 45000, label: "Y9" },
    { id: "Y10", pos: 48000, label: "Y10" },
    { id: "Y11", pos: 54000, label: "Y11" }
  ]
};
