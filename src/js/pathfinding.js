// ==========================================================================
// 平面図（SVG, 単位mm）上での最短経路探索
// ==========================================================================
// 各フロアの部屋データ（room.bounding_box_mm）はすべて軸並行の矩形であり、
// 「building_outlineの内側 かつ どの部屋の矩形にも属さない領域」が
// そのまま廊下（平面図上の黒い部分）に一致する。したがって経路探索の
// 障害物は「部屋の矩形（目的の部屋自身を除く）」だけで表現でき、
// CADの壁線データ（floorObj.walls、5000本超/フロア）は建具・什器・
// 寸法線なども混在した参照用レイヤーであり、経路探索には使わない。
//
// アルゴリズム：
//   1. building_outlineのbounding boxを一定サイズ(mm)のセルに分割し、
//      部屋矩形（目的の部屋を除く）が重なるセルを通行不可とする。
//   2. スタート地点・ゴール地点をセルに変換し（通行不可セルに落ちた場合は
//      周辺の通行可能セルまでスパイラル探索で補正）、8方向A*で最短経路を探索。
//   3. 得られたセル列は "string pulling"（見通し判定によるショートカット）
//      で間引き、折れ線が少ない自然な経路に整形する。
// ==========================================================================

const DEFAULT_CELL_SIZE_MM = 250;

// ==========================================================================
// 階段を経由したフロアをまたぐ経路探索
// ==========================================================================
// 全フロアは同一のXY座標系を共有しているため（gps.js/app.jsのコメント参照）、
// 同じ物理的な階段室は、各フロアの平面図上でほぼ同じXY位置に存在する。
// この性質を利用し、「category === 'stair_elv' かつ 部屋名に『階段』を含む
// （エレベーターは除く）」部屋を全フロアから集め、XY位置が近いものどうしを
// 同じ階段室（クラスタ）とみなして、フロア間の乗り継ぎノードとして扱う。
// ==========================================================================

// この距離(mm)以内にある「階段」部屋は同じ階段室（＝上下階で繋がっている）とみなす。
// CADデータの階ごとの微妙なズレを吸収しつつ、離れた別の階段と誤って
// 同一視しないよう、建物内の階段間隔よりは十分小さい値にしておく。
const STAIR_LINK_RADIUS_MM = 4000;

// 階段を1フロア分昇降する際の概算コスト(mm相当)。実際の高低差の情報は無いため、
// 「階段の利用回数が少ない経路」をゆるく優先させるための重み付けとして使う値であり、
// 表示する経路距離（水平方向の歩行距離）には含めない。
const STAIR_TRANSITION_COST_MM = 6000;

/**
 * 部屋オブジェクトが「階段」かどうかを判定する（エレベーターは含まない）。
 * app.js の getRoomIconMeta() と同様、部屋名（display_label / room_name）に
 * 「階段」を含むかどうかで判定する。categoryは部屋データ上「classroom」等
 * 他の値になっていることがあり当てにならないため、名称のみで判定する。
 */
export function isStairRoom(room) {
  if (!room || !room.center_point_mm) return false;
  const name = `${room.display_label || ''} ${room.room_name || ''}`;
  const normalized = name.replace(/\s+/g, '');
  if (!normalized.includes('階段')) return false;
  if (/トイレ|便所|WC/i.test(normalized)) return false;
  if (/(エレベータ|エレベーター|EV)/i.test(normalized)) return false;
  return true;
}

/** 8方向の移動（dx, dy, 移動コスト）。斜め移動は、両側の直交セルがどちらも
 *  通行不可の場合は「壁の角をすり抜ける」形になるため許可しない。 */
const DIRECTIONS = [
  { dx: 1, dy: 0, cost: 1 },
  { dx: -1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 1, cost: 1.8 },
  { dx: 1, dy: -1, cost: 1.8 },
  { dx: -1, dy: 1, cost: 1.8 },
  { dx: -1, dy: -1, cost: 1.8 }
];

/** fScore最小のノードを取り出す二分ヒープ（グリッドが数万セル規模になるため、
 *  線形探索の優先度キューだと遅くなる可能性があり必須）。 */
class MinHeap {
  constructor() {
    this.items = []; // { idx, f }
  }
  get size() { return this.items.length; }
  push(item) {
    const arr = this.items;
    arr.push(item);
    let i = arr.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (arr[parent].f <= arr[i].f) break;
      [arr[parent], arr[i]] = [arr[i], arr[parent]];
      i = parent;
    }
  }
  pop() {
    const arr = this.items;
    const top = arr[0];
    const last = arr.pop();
    if (arr.length > 0) {
      arr[0] = last;
      let i = 0;
      const n = arr.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < n && arr[l].f < arr[smallest].f) smallest = l;
        if (r < n && arr[r].f < arr[smallest].f) smallest = r;
        if (smallest === i) break;
        [arr[smallest], arr[i]] = [arr[i], arr[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

export class RoutePlanner {
  constructor(cellSizeMm = DEFAULT_CELL_SIZE_MM) {
    this.cellSizeMm = cellSizeMm;
  }

  /**
   * floorObj上で、startMm({x,y}) から targetRoomId の部屋（center_point_mm）までの
   * 最短経路を探索する。
   * @returns {{points: number[][], distanceMm: number} | null}
   *   points: 経路のmm座標列（[[x,y], ...]、間引き・平滑化済み）
   *   distanceMm: 経路の概算総距離(mm)
   *   探索不能（到達不可能・データ不足）の場合はnullを返す。
   */
  findRoute(floorObj, startMm, targetRoomId) {
    if (!floorObj || !startMm || !targetRoomId) return null;
    const targetRoom = floorObj.rooms.find(r => r.room_id === targetRoomId);
    if (!targetRoom || !targetRoom.center_point_mm) return null;

    const startRect = this._findRoomRectAtPoint(floorObj, startMm);
    const targetRect = this._rectWithPreferredEntrySide(floorObj, targetRoom, targetRoom.bounding_box_mm);
    return this.findRouteToPoint(
      floorObj,
      startMm,
      { x: targetRoom.center_point_mm[0], y: targetRoom.center_point_mm[1] },
      [targetRoomId],
      targetRect,
      startRect
    );
  }

  /**
   * findRoute() を一般化したもの。目的地を「部屋ID」ではなく任意のmm座標で指定できる。
   * 階段の乗り継ぎ地点など、部屋の中心そのものではあるが目的の部屋ではない地点まで
   * 経路を引きたい場合（フロアをまたぐ経路探索）に使う。
   * excludeRoomIdsは呼び出し互換のため引数として残しているが、_buildGrid()では
   * 使用しない（始点・終点を含む部屋であっても常に障害物として扱う。詳細は
   * _buildGrid()のコメントを参照）。
   * @param {{x:number,y:number,width:number,height:number}|null} targetRect
   *   targetMmが実在の部屋の中心点である場合、その部屋のbounding_box_mmを渡す。
   *   渡された場合、終点は「セル経路の最後の点から見て、その矩形の境界上で
   *   最も近い点」を経由してから実際の中心点へ入るように補正される。これにより、
   *   境界点を飛ばしていきなり中心点へ直線移動することで別の部屋の上を横切って
   *   しまう不具合を防ぐ（矩形の境界＝廊下に面した辺なので、必ず廊下側から
   *   部屋へ入る経路になる）。省略した場合（階段の乗り継ぎノードなど部屋の
   *   矩形が不明な場合）は、従来通りセル経路の終点をそのまま実座標に置き換える。
   * @param {{x:number,y:number,width:number,height:number}|null} startRect
   *   startMmについても同様（部屋の中から出発する場合など）。
   * @returns {{points: number[][], distanceMm: number} | null}
   */
  findRouteToPoint(floorObj, startMm, targetMm, excludeRoomIds = [], targetRect = null, startRect = null) {
    if (!floorObj || !startMm || !targetMm) return null;

    const inferredStartRect = startRect || this._findRoomRectAtPoint(floorObj, startMm);
    const grid = this._buildGrid(floorObj, excludeRoomIds);
    if (!grid) return null;

    const startCell = this._clampToNearestWalkable(grid, this._mmToCell(grid, startMm.x, startMm.y));
    const goalCell = this._clampToNearestWalkable(grid, this._mmToCell(grid, targetMm.x, targetMm.y));
    if (!startCell || !goalCell) return null;

    const cellPath = this._aStar(grid, startCell, goalCell);
    if (!cellPath) return null;

    let points = cellPath.map(c => this._cellToMm(grid, c.cx, c.cy));
    points = this._simplifyByLineOfSight(grid, points);

    // 終点の置き換え：矩形が分かっている場合は、直前の点から見た矩形境界上の
    // 最寄り点をまず経由してから、実際の中心点へ入る（他の部屋を横切る近道の防止）。
    if (targetRect) {
      const anchor = points[points.length - 1];
      const entry = this._closestPointOnRect(anchor[0], anchor[1], targetRect);
      points[points.length - 1] = entry;
      points.push([targetMm.x, targetMm.y]);
    } else {
      points[points.length - 1] = [targetMm.x, targetMm.y];
    }

    // 始点についても同様に補正する。
    if (inferredStartRect) {
      const anchor = points[0];
      const entry = this._closestPointOnRect(anchor[0], anchor[1], inferredStartRect);
      points[0] = entry;
      points.unshift([startMm.x, startMm.y]);
    } else {
      points[0] = [startMm.x, startMm.y];
    }

    let distanceMm = 0;
    for (let i = 1; i < points.length; i++) {
      distanceMm += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }

    return { points, distanceMm };
  }

  /**
   * フロアをまたぐ経路探索。目的の部屋が現在のフロアと異なる場合、
   * 各フロアの「階段」部屋をXY位置でグルーピングして階段室ごとのノードとし、
   * それらを介してスタート地点から目的の部屋までの最短経路（ダイクストラ法）を求める。
   * 同一フロアの場合は findRoute() と同等の単一フロア探索にフォールバックする。
   *
   * @param {Array} floors - this.data.floors 相当（各要素が floorObj）
   * @param {number} startFloorNum - スタート地点が存在するフロア番号
   * @param {{x:number,y:number}} startMm - スタート地点の平面図mm座標
   * @param {number} targetFloorNum - 目的の部屋が存在するフロア番号
   * @param {string} targetRoomId - 目的の部屋のID
   * @returns {{segments: Array, totalDistanceMm: number, floorChanges: number} | null}
   *   segments: フロアごとの経路区間の配列。各要素は
   *     { floor, points, distanceMm, enter, exit }
   *     enter: このフロアに別フロアの階段から入ってきた場合 { fromFloor, label }、
   *            スタート地点そのものであれば null
   *     exit:  このフロアから階段で別フロアへ抜ける場合 { toFloor, label }、
   *            目的の部屋に到着する最終区間であれば null
   *   探索不能な場合はnullを返す。
   */
  findMultiFloorRoute(floors, startFloorNum, startMm, targetFloorNum, targetRoomId) {
    if (!floors || !startMm || !targetRoomId) return null;

    const targetFloorObj = floors.find(f => f.floor === targetFloorNum);
    const targetRoom = targetFloorObj && targetFloorObj.rooms.find(r => r.room_id === targetRoomId);
    if (!targetRoom || !targetRoom.center_point_mm) return null;

    // 同じフロアなら階段を経由する必要が無いので、単一フロア探索で済ませる
    if (startFloorNum === targetFloorNum) {
      const result = this.findRoute(targetFloorObj, startMm, targetRoomId);
      if (!result) return null;
      return {
        segments: [{ floor: startFloorNum, points: result.points, distanceMm: result.distanceMm, enter: null, exit: null }],
        totalDistanceMm: result.distanceMm,
        floorChanges: 0
      };
    }

    const startFloorObj = floors.find(f => f.floor === startFloorNum);
    if (!startFloorObj) return null;

    const targetMm = { x: targetRoom.center_point_mm[0], y: targetRoom.center_point_mm[1] };
    const clusters = this._buildStairClusters(floors);

    // 現在のフロアから目的のフロアまで、1フロアずつ辿った時の階数の並び
    // （例: 2F→5Fなら [2,3,4,5]、5F→2Fなら [5,4,3,2]）
    const step = targetFloorNum > startFloorNum ? 1 : -1;
    const floorPath = [];
    for (let f = startFloorNum; ; f += step) {
      floorPath.push(f);
      if (f === targetFloorNum) break;
    }

    // ------- 「現在地から最短距離の階段」を優先して選ぶ -------
    // 経由するフロア全て（floorPath上の全階）に実体を持つ階段室（＝乗り換え無しで
    // 目的階まで行ける階段）だけを候補とし、その中から現在地からの歩行距離が
    // 最も短いものを選ぶ。
    const entryByFloor = (cluster, floor) => cluster.entries.find(e => e.floor === floor);
    const spanningClusters = clusters.filter(c => floorPath.every(f => entryByFloor(c, f)));

    const transitionCost = STAIR_TRANSITION_COST_MM * (floorPath.length - 1);
    let best = null; // { cluster, totalCost, startPoints, startDistanceMm, finalResult }
    spanningClusters.forEach(cluster => {
      const entryStart = entryByFloor(cluster, startFloorNum);
      const entryTarget = entryByFloor(cluster, targetFloorNum);
      if (!entryStart || !entryTarget) return;

      const stairStartMm = { x: entryStart.room.center_point_mm[0], y: entryStart.room.center_point_mm[1] };
      const startRect = this._findRoomRectAtPoint(startFloorObj, startMm);
      const startResult = this.findRouteToPoint(
        startFloorObj,
        startMm,
        stairStartMm,
        [entryStart.room.room_id],
        entryStart.room.bounding_box_mm,
        startRect
      );
      if (!startResult) return;

      const targetMm = { x: targetRoom.center_point_mm[0], y: targetRoom.center_point_mm[1] };
      const stairTargetMm = { x: entryTarget.room.center_point_mm[0], y: entryTarget.room.center_point_mm[1] };
      const endRect = this._roomRectById(targetFloorObj, entryTarget.room.room_id);
      const targetRect = this._rectWithPreferredEntrySide(targetFloorObj, targetRoom, targetRoom.bounding_box_mm);
      const finalResult = this.findRouteToPoint(
        targetFloorObj,
        stairTargetMm,
        targetMm,
        [entryTarget.room.room_id, targetRoomId],
        targetRect,
        endRect
      );
      if (!finalResult) return;

      const totalCost = startResult.distanceMm + finalResult.distanceMm + transitionCost;
      if (!best || totalCost < best.totalCost) {
        best = {
          cluster,
          totalCost,
          startPoints: startResult.points,
          startDistanceMm: startResult.distanceMm,
          finalResult,
          entryStart,
          entryTarget
        };
      }
    });

    if (best) {
      // 選んだ階段室を使って、フロアごとの経路区間を組み立てる
      const segments = [];
      // 起点フロア：現在地 → 最寄りの階段
      const firstEntry = entryByFloor(best.cluster, startFloorNum);
      const nextFloorAfterFirst = floorPath[1];
      segments.push({
        floor: startFloorNum,
        points: best.startPoints,
        distanceMm: best.startDistanceMm,
        enter: null,
        exit: { toFloor: nextFloorAfterFirst, label: firstEntry.room.display_label || firstEntry.room.room_name || '階段' }
      });

      // 中間フロア（通過するだけの階）：階段室の1点だけの区間
      for (let idx = 1; idx < floorPath.length - 1; idx++) {
        const floor = floorPath[idx];
        const entry = entryByFloor(best.cluster, floor);
        const label = entry.room.display_label || entry.room.room_name || '階段';
        segments.push({
          floor,
          points: [[entry.room.center_point_mm[0], entry.room.center_point_mm[1]]],
          distanceMm: 0,
          enter: { fromFloor: floorPath[idx - 1], label },
          exit: { toFloor: floorPath[idx + 1], label }
        });
      }

      // 終点フロア：階段の到着地点 → 目的の部屋
      const lastEntry = entryByFloor(best.cluster, targetFloorNum);
      segments.push({
        floor: targetFloorNum,
        points: best.finalResult.points,
        distanceMm: best.finalResult.distanceMm,
        enter: { fromFloor: floorPath[floorPath.length - 2], label: lastEntry.room.display_label || lastEntry.room.room_name || '階段' },
        exit: null
      });

      const totalDistanceMm = segments.reduce((sum, s) => sum + s.distanceMm, 0);
      return { segments, totalDistanceMm, floorChanges: segments.length - 1 };
    }

    // ------- 乗り換え無しで行ける階段が無い場合は、階段の乗り換えも含めた
    // 全体最短経路探索（ダイクストラ法）にフォールバックする -------
    return this._findMultiFloorRouteGraph(floors, startFloorNum, startMm, targetFloorNum, targetRoomId, clusters);
  }

  /** 全フロアの「階段」部屋を、XY位置が近いものどうしで同一階段室とみなしてクラスタリングする */
  _buildStairClusters(floors) {
    const clusters = [];
    floors.forEach(floorObj => {
      (floorObj.rooms || []).forEach(room => {
        if (!isStairRoom(room)) return;
        const [x, y] = room.center_point_mm;
        let cluster = clusters.find(c => Math.hypot(c.x - x, c.y - y) <= STAIR_LINK_RADIUS_MM);
        if (!cluster) {
          cluster = { id: `stair${clusters.length}`, x, y, entries: [] };
          clusters.push(cluster);
        }
        cluster.entries.push({ floor: floorObj.floor, room });
      });
    });
    return clusters;
  }

  /**
   * findMultiFloorRoute() のフォールバック：乗り換え無しで目的階まで行ける単一の
   * 階段が見つからない場合に、複数の階段室を乗り継ぐ経路も含めて全体最短経路を
   * ダイクストラ法で探索する（階段の乗り継ぎコストはSTAIR_TRANSITION_COST_MMで概算）。
   */
  _findMultiFloorRouteGraph(floors, startFloorNum, startMm, targetFloorNum, targetRoomId, clusters) {
    const targetFloorObj = floors.find(f => f.floor === targetFloorNum);
    const targetRoom = targetFloorObj.rooms.find(r => r.room_id === targetRoomId);

    // ------- グラフのノード定義 -------
    // 'START' / 'TARGET' の仮想ノードと、階段室クラスタの「フロアごとの実体」をノードとする。
    const nodes = new Map(); // nodeId -> { floor, mm:{x,y}, roomId, label }
    nodes.set('START', { floor: startFloorNum, mm: { x: startMm.x, y: startMm.y }, roomId: null, label: '現在地' });
    nodes.set('TARGET', {
      floor: targetFloorNum,
      mm: { x: targetRoom.center_point_mm[0], y: targetRoom.center_point_mm[1] },
      roomId: targetRoomId,
      label: targetRoom.display_label || targetRoom.room_name || '目的地'
    });
    clusters.forEach(cluster => {
      cluster.entries.forEach(({ floor, room }) => {
        nodes.set(`${cluster.id}@${floor}`, {
          floor,
          mm: { x: room.center_point_mm[0], y: room.center_point_mm[1] },
          roomId: room.room_id,
          label: room.display_label || room.room_name || '階段',
          clusterId: cluster.id
        });
      });
    });

    const nodesByFloor = new Map();
    nodes.forEach((info, id) => {
      if (!nodesByFloor.has(info.floor)) nodesByFloor.set(info.floor, []);
      nodesByFloor.get(info.floor).push(id);
    });

    // ------- グラフのエッジ定義 -------
    const adj = new Map();
    nodes.forEach((_, id) => adj.set(id, []));
    const addEdge = (a, b, weight) => {
      adj.get(a).push({ to: b, weight });
      adj.get(b).push({ to: a, weight });
    };

    // 同一フロア内のノード同士は、実際の平面図上の経路距離で接続する
    nodesByFloor.forEach((idsOnFloor, floorNum) => {
      const floorObj = floors.find(f => f.floor === floorNum);
      if (!floorObj) return;
      for (let i = 0; i < idsOnFloor.length; i++) {
        for (let j = i + 1; j < idsOnFloor.length; j++) {
          const idA = idsOnFloor[i];
          const idB = idsOnFloor[j];
          const infoA = nodes.get(idA);
          const infoB = nodes.get(idB);
          const excludeIds = [infoA.roomId, infoB.roomId].filter(Boolean);
          const rectA = this._roomRectById(floorObj, infoA.roomId);
          const roomB = infoB.roomId ? floorObj.rooms.find(r => r.room_id === infoB.roomId) : null;
          const rectB = this._rectWithPreferredEntrySide(floorObj, roomB, this._roomRectById(floorObj, infoB.roomId));
          const startRect = (idA === 'START' || infoA.roomId === null) ? this._findRoomRectAtPoint(floorObj, infoA.mm) : rectA;
          const result = this.findRouteToPoint(floorObj, infoA.mm, infoB.mm, excludeIds, rectB, startRect);
          if (result) addEdge(idA, idB, result.distanceMm);
        }
      }
    });

    // 同じ階段室（クラスタ）の、隣接するフロア同士を階段の昇降として接続する
    // （データが欠けているなどで1フロア分の対応が取れない場合は直接繋げない）
    clusters.forEach(cluster => {
      const byFloor = [...cluster.entries].sort((a, b) => a.floor - b.floor);
      for (let i = 0; i < byFloor.length - 1; i++) {
        const f1 = byFloor[i].floor;
        const f2 = byFloor[i + 1].floor;
        if (f2 - f1 !== 1) continue;
        addEdge(`${cluster.id}@${f1}`, `${cluster.id}@${f2}`, STAIR_TRANSITION_COST_MM);
      }
    });

    // ------- ダイクストラ法で 'START' から 'TARGET' までの最短経路を探す -------
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    nodes.forEach((_, id) => dist.set(id, Infinity));
    dist.set('START', 0);

    const heap = new MinHeap();
    heap.push({ idx: 'START', f: 0 });
    while (heap.size > 0) {
      const cur = heap.pop();
      if (visited.has(cur.idx)) continue;
      visited.add(cur.idx);
      if (cur.idx === 'TARGET') break;
      for (const edge of adj.get(cur.idx)) {
        if (visited.has(edge.to)) continue;
        const nd = dist.get(cur.idx) + edge.weight;
        if (nd < dist.get(edge.to)) {
          dist.set(edge.to, nd);
          prev.set(edge.to, cur.idx);
          heap.push({ idx: edge.to, f: nd });
        }
      }
    }

    if (!Number.isFinite(dist.get('TARGET'))) return null; // 到達不可能（階段の対応が取れない等）

    // ノードID列に復元
    const nodeChain = [];
    let cur = 'TARGET';
    let guard = nodes.size + 1;
    while (cur !== undefined && guard-- > 0) {
      nodeChain.push(cur);
      if (cur === 'START') break;
      cur = prev.get(cur);
    }
    nodeChain.reverse();
    if (nodeChain[0] !== 'START') return null;

    // ------- ノード列を「フロアごとの経路区間」に変換する -------
    const segments = [];
    let i = 0;
    while (i < nodeChain.length - 1) {
      const startInfo = nodes.get(nodeChain[i]);
      let j = i;
      while (j + 1 < nodeChain.length && nodes.get(nodeChain[j + 1]).floor === startInfo.floor) {
        j++;
      }
      const endInfo = nodes.get(nodeChain[j]);
      const floorObj = floors.find(f => f.floor === startInfo.floor);

      let segPoints = [[startInfo.mm.x, startInfo.mm.y]];
      let segDistance = 0;
      for (let k = i; k < j; k++) {
        const a = nodes.get(nodeChain[k]);
        const b = nodes.get(nodeChain[k + 1]);
        const excludeIds = [a.roomId, b.roomId].filter(Boolean);
        const rectA = this._roomRectById(floorObj, a.roomId);
        const rectB = this._roomRectById(floorObj, b.roomId);
        const startRect = this._roomRectById(floorObj, a.roomId) || this._findRoomRectAtPoint(floorObj, a.mm);
        const result = this.findRouteToPoint(floorObj, a.mm, b.mm, excludeIds, rectB, startRect);
        if (!result) return null;
        segPoints = segPoints.concat(result.points.slice(1));
        segDistance += result.distanceMm;
      }

      const enter = (i === 0) ? null : { fromFloor: nodes.get(nodeChain[i - 1]).floor, label: startInfo.label };
      const exit = (j === nodeChain.length - 1) ? null : { toFloor: nodes.get(nodeChain[j + 1]).floor, label: endInfo.label };

      segments.push({ floor: startInfo.floor, points: segPoints, distanceMm: segDistance, enter, exit });
      i = j + 1;
    }

    const totalDistanceMm = segments.reduce((sum, s) => sum + s.distanceMm, 0);
    return { segments, totalDistanceMm, floorChanges: segments.length - 1 };
  }

  // ------------------------------------------------------------------------

  _buildGrid(floorObj, excludeRoomIds) {
    const outline = floorObj.building_outline;
    if (!outline || outline.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    outline.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });

    const cellSize = this.cellSizeMm;
    const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize));
    const blocked = new Uint8Array(cols * rows); // 0=通行可, 1=通行不可

    const grid = { cols, rows, minX, minY, maxX, maxY, cellSize, blocked };

    // 注意: 始点・終点（階段室や目的の部屋）であっても、その部屋の矩形は
    // 「通行不可」のまま扱う（excludeRoomIdsはここでは使わない）。
    // 以前はここで対象の部屋を丸ごと通行可能にしていたが、そうすると
    // その部屋の内部全体が障害物なしの空間になってしまい、A*が
    // 廊下（黒い部分）を迂回せず部屋の中を斜めに突っ切る「近道」を
    // 見つけてしまう不具合があった（部屋の対角を貫く不自然な経路の原因）。
    // 部屋を常に障害物として扱っても、start/goal地点は
    // _clampToNearestWalkable() が自動的に最寄りの廊下セルへ補正し、
    // 経路の端点は findRouteToPoint() 側で実際のmm座標に上書きされるため、
    // 「廊下を歩いてきて、最後に部屋へ入る短い区間」が描かれるだけで、
    // 部屋の中心・階段の中心まで問題なく到達できる。
    (floorObj.rooms || []).forEach(room => {
      const b = room.bounding_box_mm;
      if (!b) return;
      this._markRectBlocked(grid, b.x, b.y, b.x + b.width, b.y + b.height);
    });

    return grid;
  }

  _markRectBlocked(grid, x0, y0, x1, y1) {
    const c0 = Math.max(0, Math.floor((x0 - grid.minX) / grid.cellSize));
    const c1 = Math.min(grid.cols - 1, Math.ceil((x1 - grid.minX) / grid.cellSize) - 1);
    const r0 = Math.max(0, Math.floor((y0 - grid.minY) / grid.cellSize));
    const r1 = Math.min(grid.rows - 1, Math.ceil((y1 - grid.minY) / grid.cellSize) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        grid.blocked[r * grid.cols + c] = 1;
      }
    }
  }

  /** 点(px,py)から矩形rect（部屋のbounding_box_mm）境界上の最も近い点を求める。
   *  点が矩形の外側にある場合、x/yそれぞれを矩形の範囲内にクランプするだけで
   *  境界上の最近点になる（軸並行矩形における標準的な求め方）。 */
  _rectWithPreferredEntrySide(floorObj, room, rect) {
    if (!rect) return rect;
    const preferredSide = this._preferredEntrySideForRoom(floorObj, room);
    if (!preferredSide) return rect;
    return { ...rect, preferredEntrySide: preferredSide };
  }

  _preferredEntrySideForRoom(floorObj, room) {
    if (!room || !floorObj) return null;

    const targetNumbers = new Set(['318', '319', '425', '426', '431', '539', '550', '551', '562']);
    const roomNumber = room.display_number || room.room_number || room.room_id;
    if (!targetNumbers.has(String(roomNumber))) return null;

    const outline = floorObj.building_outline || [];
    if (!outline.length) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    outline.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    const floorCenterX = (minX + maxX) / 2;
    const floorCenterY = (minY + maxY) / 2;
    const roomCenterX = (room.center_point_mm && room.center_point_mm[0]) || (room.bounding_box_mm ? room.bounding_box_mm.x + room.bounding_box_mm.width / 2 : null);
    const roomCenterY = (room.center_point_mm && room.center_point_mm[1]) || (room.bounding_box_mm ? room.bounding_box_mm.y + room.bounding_box_mm.height / 2 : null);
    if (roomCenterX == null || roomCenterY == null) return null;

    // 4隅の部屋は内側（建物中心に向かった側）から入る。
    // 左側（西側）の部屋は右から、右側（東側）の部屋は左から入る。
    // 上側（北側）の部屋は下から、下側（南側）の部屋は上から入る。
    // ただし、4隅の部屋は2つの方向が該当するため、優先度は X 軸（左右）を優先。
    if (roomCenterX < floorCenterX) {
      return 'right';  // 西側の部屋は東（右）から入る
    }
    if (roomCenterX > floorCenterX) {
      return 'left';   // 東側の部屋は西（左）から入る
    }
    // X 軸がほぼ中央の場合は Y 軸で判定
    if (roomCenterY < floorCenterY) {
      return 'bottom'; // 北側の部屋は南（下）から入る
    }
    if (roomCenterY > floorCenterY) {
      return 'top';    // 南側の部屋は北（上）から入る
    }
    return null;
  }

  _closestPointOnRect(px, py, rect) {
    if (!rect) return [px, py];
    const side = rect.preferredEntrySide;
    if (side === 'left') {
      return [rect.x, Math.min(Math.max(py, rect.y), rect.y + rect.height)];
    }
    if (side === 'right') {
      return [rect.x + rect.width, Math.min(Math.max(py, rect.y), rect.y + rect.height)];
    }
    if (side === 'top') {
      return [Math.min(Math.max(px, rect.x), rect.x + rect.width), rect.y];
    }
    if (side === 'bottom') {
      return [Math.min(Math.max(px, rect.x), rect.x + rect.width), rect.y + rect.height];
    }

    const x = Math.min(Math.max(px, rect.x), rect.x + rect.width);
    const y = Math.min(Math.max(py, rect.y), rect.y + rect.height);
    return [x, y];
  }

  /** 指定mm座標が属する部屋のbounding_box_mmを返す（無ければnull）。 */
  _findRoomRectAtPoint(floorObj, mm) {
    if (!floorObj || !mm) return null;
    const rooms = floorObj.rooms || [];
    for (const room of rooms) {
      const rect = room && room.bounding_box_mm;
      if (!rect) continue;
      if (mm.x >= rect.x && mm.x <= rect.x + rect.width && mm.y >= rect.y && mm.y <= rect.y + rect.height) {
        return rect;
      }
    }
    return null;
  }

  /** roomIdから、その部屋のbounding_box_mmを引く（無ければnull）。 */
  _roomRectById(floorObj, roomId) {
    if (!roomId) return null;
    const room = (floorObj.rooms || []).find(r => r.room_id === roomId);
    return (room && room.bounding_box_mm) ? room.bounding_box_mm : null;
  }

  _mmToCell(grid, x, y) {
    const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.minX) / grid.cellSize)));
    const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.minY) / grid.cellSize)));
    return { cx, cy };
  }

  _cellToMm(grid, cx, cy) {
    return [
      grid.minX + (cx + 0.5) * grid.cellSize,
      grid.minY + (cy + 0.5) * grid.cellSize
    ];
  }

  _isBlocked(grid, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
    return grid.blocked[cy * grid.cols + cx] === 1;
  }

  /** セルが通行不可の場合、BFSで最寄りの通行可能セルまで探索して補正する
   *  （GPS誤差で部屋の中に落ちた場合や、出入口が境界ぎりぎりの場合の保険）。 */
  _clampToNearestWalkable(grid, cell) {
    if (!this._isBlocked(grid, cell.cx, cell.cy)) return cell;
    const visited = new Uint8Array(grid.cols * grid.rows);
    const queue = [cell];
    visited[cell.cy * grid.cols + cell.cx] = 1;
    let head = 0;
    const maxSteps = grid.cols * grid.rows;
    let steps = 0;
    while (head < queue.length && steps < maxSteps) {
      const cur = queue[head++];
      steps++;
      for (const d of DIRECTIONS) {
        const nx = cur.cx + d.dx;
        const ny = cur.cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
        const key = ny * grid.cols + nx;
        if (visited[key]) continue;
        visited[key] = 1;
        if (!this._isBlocked(grid, nx, ny)) return { cx: nx, cy: ny };
        queue.push({ cx: nx, cy: ny });
      }
    }
    return null; // 建物全体が塞がっている等、通常は起こらない
  }

  _countWalkableNeighbors(grid, cx, cy) {
    let count = 0;
    for (const d of DIRECTIONS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      if (!this._isBlocked(grid, nx, ny)) count++;
    }
    return count;
  }

  _aStar(grid, start, goal) {
    const { cols, rows } = grid;
    const startIdx = start.cy * cols + start.cx;
    const goalIdx = goal.cy * cols + goal.cx;
    if (startIdx === goalIdx) {
      return [{ cx: start.cx, cy: start.cy }];
    }

    const gScore = new Float64Array(cols * rows).fill(Infinity);
    const cameFrom = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    gScore[startIdx] = 0;

    const heuristic = (cx, cy) => Math.hypot(cx - goal.cx, cy - goal.cy);

    const heap = new MinHeap();
    heap.push({ idx: startIdx, f: heuristic(start.cx, start.cy) });

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur.idx]) continue;
      closed[cur.idx] = 1;
      if (cur.idx === goalIdx) break;

      const cx = cur.idx % cols;
      const cy = (cur.idx / cols) | 0;

      for (const d of DIRECTIONS) {
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (this._isBlocked(grid, nx, ny)) continue;
        // 斜め移動時、両側の直交セルが両方とも通行不可なら角をすり抜けてしまうため禁止
        if (d.dx !== 0 && d.dy !== 0) {
          if (this._isBlocked(grid, cx + d.dx, cy) && this._isBlocked(grid, cx, cy + d.dy)) continue;
        }
        const nIdx = ny * cols + nx;
        if (closed[nIdx]) continue;
        // 廊下の中央寄りを好むように、周囲に空きが多いセルほどコストを下げる。
        // 壁や部屋に近いセルは、通路の端に寄りやすいため少し高めにする。
        const openNeighbors = this._countWalkableNeighbors(grid, nx, ny);
        const clearancePenalty = Math.max(0, 6 - openNeighbors) * 0.35;
        const diagonalPenalty = (d.dx !== 0 && d.dy !== 0) ? 0.6 : 0;
        const tentativeG = gScore[cur.idx] + d.cost + clearancePenalty + diagonalPenalty;
        if (tentativeG < gScore[nIdx]) {
          gScore[nIdx] = tentativeG;
          cameFrom[nIdx] = cur.idx;
          heap.push({ idx: nIdx, f: tentativeG + heuristic(nx, ny) });
        }
      }
    }

    if (!closed[goalIdx] && gScore[goalIdx] === Infinity) return null;

    // 経路復元
    const path = [];
    let idx = goalIdx;
    let guard = cols * rows + 1;
    while (idx !== -1 && guard-- > 0) {
      path.push({ cx: idx % cols, cy: (idx / cols) | 0 });
      if (idx === startIdx) break;
      idx = cameFrom[idx];
    }
    path.reverse();
    if (path.length === 0 || path[0].cx !== start.cx || path[0].cy !== start.cy) return null;
    return path;
  }

  /**
   * "string pulling": 現在のアンカーから見通せる最も遠い点まで直接ジャンプすることで、
   * ジグザグなセル経路を折れ線の少ない自然な経路に間引く。
   */
  _simplifyByLineOfSight(grid, points) {
    if (points.length <= 2) return points;
    const result = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let farthest = anchor + 1;
      for (let j = points.length - 1; j > anchor; j--) {
        if (this._hasLineOfSight(grid, points[anchor], points[j])) {
          farthest = j;
          break;
        }
      }
      result.push(points[farthest]);
      anchor = farthest;
    }
    return result;
  }

  _hasLineOfSight(grid, p1, p2) {
    const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const step = grid.cellSize / 2;
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = p1[0] + (p2[0] - p1[0]) * t;
      const y = p1[1] + (p2[1] - p1[1]) * t;
      const cell = this._mmToCell(grid, x, y);
      if (this._isBlocked(grid, cell.cx, cell.cy)) return false;
    }
    return true;
  }
}
