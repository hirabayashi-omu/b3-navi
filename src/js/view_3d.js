/**
 * B3 Building 2.5D Stacked Floor Isometric Renderer
 * 全6階層を立体的に積層描画する 2.5D/Isometric Canvas レンダラー
 *
 * app.js が保持する「編集可能な」フロアデータ（building_outline / rooms[].polygon_mm）を
 * そのまま渡して使う設計。固定の grid_config / floors_data モジュールには依存しない。
 */
export class Stacked3DRenderer {
  /**
   * @param {HTMLCanvasElement} canvasElement
   * @param {Object} [options]
   * @param {number} [options.totalWidth]  平面図全体の幅 (mm)。isoProject の中心基準に使う
   * @param {number} [options.totalHeight] 平面図全体の高さ (mm)
   * @param {(floorNum: number) => void} [options.onFloorClick] フロア板をクリックした時のコールバック
   */
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');

    // アイソメトリック投影パラメータ
    this.angleX = 45 * Math.PI / 180; // 45度
    this.angleZ = 30 * Math.PI / 180; // 30度
    this.scale = 0.008;
    this.floorSpacing = 160; // 階間ピクセル距離

    this.offsetX = 0;
    this.offsetY = 0;
    // 検索結果フォーカスや回転中心補正のための追加パンオフセット（ユーザーのドラッグ回転とは別枠）
    this.panOffsetX = 0;
    this.panOffsetY = 0;
    this.isRotating = false;
    this.dragMoved = false;
    this.rotStart = { x: 0, y: 0 };

    // 描画対象データ（setData で app.js から渡される）
    this.floorsData = [];
    this.categoryColors = {};
    this.totalWidth = options.totalWidth || 48400;
    this.totalHeight = options.totalHeight || 54000;
    this.onFloorClick = typeof options.onFloorClick === 'function' ? options.onFloorClick : null;

    // クリック判定用：直近の描画で計算したフロア板のスクリーン座標ポリゴン
    this._floorHitAreas = [];

    // 検索結果などから指定された「ハイライトすべき部屋」（フロアは切り替えず強調表示するだけ）
    this.highlightTarget = null; // { floor: number, roomId: string } | null
    this.route = null;
    this.singleFloorNumber = null; // 指定があれば単一フロアのみを立体箱表示する

    this.animationFrameId = null;

    this.init();
  }

  /**
   * 単一フロアのみを大きく立体箱表示するモードを設定/解除する。
   * 横幅が画面内にすべてすっぽり納まる自動スケール調整を行う。
   * @param {number|null} floorNum
   */
  setSingleFloorMode(floorNum) {
    this.singleFloorNumber = typeof floorNum === 'number' ? floorNum : null;
    this.panOffsetX = 0;
    this.panOffsetY = 0;
    if (this.singleFloorNumber !== null && this.canvas.width > 0) {
      const margin = 60;
      const fitScaleX = (this.canvas.width - margin * 2) / (this.totalWidth * 1.35);
      const fitScaleY = (this.canvas.height - margin * 2) / (this.totalHeight * 1.1);
      this.scale = Math.min(fitScaleX, fitScaleY, 0.016);
    } else {
      this.scale = 0.008;
    }
    this.render();
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindEvents();
  }

  /**
   * 描画するフロアデータを差し替えて再描画する。
   * @param {Array<{floor:number, building_outline:number[][], rooms:Array<{polygon_mm:number[][], fillColor?:string, strokeColor?:string, category?:string}>}>} floorsData
   * @param {Object} [categoryColors] カテゴリキー -> {fill, stroke} のマップ（room側にfillColor/strokeColor指定が無い場合のフォールバック）
   * @param {{width:number, height:number}} [dims] 平面図全体のサイズ (mm)
   */
  setData(floorsData, categoryColors, dims) {
    this.floorsData = Array.isArray(floorsData) ? floorsData : [];
    this.categoryColors = categoryColors || {};
    if (dims && dims.width && dims.height) {
      this.totalWidth = dims.width;
      this.totalHeight = dims.height;
    }
    this.render();
  }

  /**
   * 検索結果などから、フロアを切り替えずに特定の部屋を強調表示する。
   * @param {number} floor
   * @param {string} roomId
   */
  highlightRoom(floor, roomId) {
    this.highlightTarget = { floor, roomId };
    // 検索結果が画面内にきちんと収まって見えるよう、見やすい角度・ズームに調整し、
    // 対象の部屋がキャンバス中央に来るようカメラ（パンオフセット）を自動調整する
    this.focusOnTarget();
    this.render();
    // ハイライトした部屋を点滅させる（Canvasなので CSS アニメーションが使えず、
    // requestAnimationFrame で明滅させながら再描画し続ける必要がある）
    this.startHighlightBlink();
  }

  /** ハイライト表示を解除する。 */
  clearHighlight() {
    this.highlightTarget = null;
    // フォーカス用に加えていたパンオフセットを解除し、通常の全体表示に戻す
    this.panOffsetX = 0;
    this.panOffsetY = 0;
    this.stopHighlightBlink();
    this.render();
  }

  /** 指定された拡大・縮小率で3Dビューをズームする。 */
  zoomBy(factor) {
    this.scale = Math.max(0.002, Math.min(0.03, this.scale * factor));
    this.render();
  }

  /** 3Dビューの角度・ズーム・パン位置を初期状態にリセットする。 */
  resetView() {
    this.angleX = 45 * Math.PI / 180;
    this.angleZ = 30 * Math.PI / 180;
    this.scale = 0.008;
    this.panOffsetX = 0;
    this.panOffsetY = 0;
    this.highlightTarget = null;
    this.stopHighlightBlink();
    this.render();
  }

  /** 3Dレンダラーに現在の経路を渡す。 */
  setRoute(route) {
    this.route = route && Array.isArray(route.segments) ? route : null;
    this.render();
  }

  /** 指定フロアの経路区間を3D描画する。 */
  drawRouteForFloor(floorData, zHeight) {
    if (!this.route || !Array.isArray(this.route.segments)) return;
    const segment = this.route.segments.find(s => s.floor === floorData.floor);
    if (!segment || !segment.points || segment.points.length === 0) return;

    const plotPoint = (mm) => this.isoProject(mm[0], mm[1], zHeight + 700);
    const points = segment.points.map(plotPoint);

    if (points.length >= 2) {
      this.ctx.save();
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.shadowColor = 'rgba(34, 197, 94, 0.65)';
      this.ctx.shadowBlur = 12;
      this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
      this.ctx.lineWidth = 10;
      this.ctx.beginPath();
      points.forEach((p, idx) => {
        if (idx === 0) this.ctx.moveTo(p.x, p.y);
        else this.ctx.lineTo(p.x, p.y);
      });
      this.ctx.stroke();
      this.ctx.restore();

      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.lineWidth = 4;
      this.ctx.setLineDash([14, 8]);
      this.ctx.beginPath();
      points.forEach((p, idx) => {
        if (idx === 0) this.ctx.moveTo(p.x, p.y);
        else this.ctx.lineTo(p.x, p.y);
      });
      this.ctx.stroke();
      this.ctx.restore();
    } else {
      const p = points[0];
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    // 開始・終了マーカー
    const drawMarker = (p, color) => {
      this.ctx.save();
      this.ctx.fillStyle = color;
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
    };

    if (points.length >= 1) {
      drawMarker(points[0], '#22c55e');
      drawMarker(points[points.length - 1], '#7c3aed');
    }

    this.drawVerticalRouteConnector(floorData, segment, zHeight);
  }

  /** 階をまたぐ経路を縦方向に繋いで表示する。 */
  drawVerticalRouteConnector(floorData, segment, zHeight) {
    if (!this.route || !Array.isArray(this.route.segments)) return;
    const currentIndex = this.route.segments.findIndex(s => s.floor === floorData.floor);
    if (currentIndex < 0 || currentIndex === this.route.segments.length - 1) return;

    const nextSegment = this.route.segments[currentIndex + 1];
    if (!nextSegment || Math.abs(nextSegment.floor - segment.floor) !== 1) return;
    if (!segment.points || segment.points.length === 0 || !nextSegment.points || nextSegment.points.length === 0) return;

    const currentEnd = segment.points[segment.points.length - 1];
    const nextStart = nextSegment.points[0];
    const p1 = this.isoProject(currentEnd[0], currentEnd[1], zHeight + 700);
    const nextZHeight = (nextSegment.floor - 1) * this.floorSpacing / this.scale;
    const p2 = this.isoProject(nextStart[0], nextStart[1], nextZHeight + 700);

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.85)';
    this.ctx.lineWidth = 6;
    this.ctx.setLineDash([8, 6]);
    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.lineTo(p2.x, p2.y);
    this.ctx.stroke();
    this.ctx.restore();

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
    this.ctx.beginPath();
    this.ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /** ハイライト中の部屋を点滅させ続けるアニメーションループを開始する（多重起動防止付き）。 */
  startHighlightBlink() {
    if (this.animationFrameId) return;
    const loop = () => {
      if (!this.highlightTarget) {
        this.animationFrameId = null;
        return;
      }
      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  /** 点滅アニメーションループを止める（3D表示を離れる時・ハイライト解除時などに呼ぶ）。 */
  stopHighlightBlink() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * highlightTarget（検索結果でハイライトされた部屋）が画面内で見やすい位置・角度に
   * 表示されるよう、角度／ズーム／パンオフセットを自動調整する。
   */
  focusOnTarget() {
    if (!this.highlightTarget) return;
    const floorData = this.floorsData.find(f => f.floor === this.highlightTarget.floor);
    if (!floorData) return;
    const room = (floorData.rooms || []).find(r => r.room_id === this.highlightTarget.roomId);
    if (!room || !room.polygon_mm || room.polygon_mm.length === 0) return;

    // 部屋の中心座標（建物中心を原点とした相対座標）
    const roomCx = room.polygon_mm.reduce((sum, p) => sum + p[0], 0) / room.polygon_mm.length;
    const roomCy = room.polygon_mm.reduce((sum, p) => sum + p[1], 0) / room.polygon_mm.length;
    const relX = roomCx - this.totalWidth / 2;
    const relY = roomCy - this.totalHeight / 2;

    // 建物を上から重ねて描く都合上（各階の床は不透明に近い半透明ポリゴンとして
    // 下から順に描画される）、奥側（rotYが小さい側）の部屋は上の階の床板に
    // 隠れて見えにくくなる。rotY = relX*sin(angleX) + relY*cos(angleX) を
    // 最大化する angleX = atan2(relX, relY) を選ぶことで、対象の部屋が
    // 常に「最も手前（他フロアに隠れにくい側）」にくるよう視点を自動的に回転する。
    this.angleX = Math.atan2(relX, relY);
    this.angleZ = 45 * Math.PI / 180;

    // 全フロアが縦に収まりやすいよう、ズームが寄りすぎていたら少し引く
    this.scale = Math.max(0.004, Math.min(this.scale, 0.009));

    // 一旦パンオフセット無しの基準位置で対象部屋を投影し、
    // キャンバス中央とのズレをそのままパンオフセットとして与えることで中央寄せする
    this.panOffsetX = 0;
    this.panOffsetY = 0;
    const baseOffsets = this.computeBaseOffsets();

    const cx = roomCx;
    const cy = roomCy;
    const zHeight = (this.highlightTarget.floor - 1) * this.floorSpacing / this.scale;
    const projected = this.projectWithOffsets(cx, cy, zHeight, baseOffsets.x, baseOffsets.y);

    this.panOffsetX = this.canvas.width / 2 - projected.x;
    this.panOffsetY = this.canvas.height / 2 - projected.y;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    // offsetX/offsetY はビル全体の高さと現在の傾きに応じて render() 内で毎回計算し直す
    // （回転中心が1F基準に固定されていると、傾きによっては上の階が画面からはみ出すため）
    this.render();
  }

  /**
   * 現在のパンオフセットを含まない、フロア全体を鉛直方向に中央揃えするための基準オフセットを計算する。
   * 1Fだけを基準に据えると、傾き(angleZ)次第で積み上がった上階（6F等）が画面上にはみ出してしまうため、
   * 表示中の最下階〜最上階の中心がキャンバス中央にくるよう毎回計算し直す。
   */
  computeBaseOffsets() {
    let verticalCenterAdjust = 0;
    if (this.floorsData.length > 0) {
      const floorNums = this.floorsData.map(f => f.floor);
      const minFloor = Math.min(...floorNums);
      const maxFloor = Math.max(...floorNums);
      // 各フロアのzHeightは (floor-1)*floorSpacing/scale で、isoProject内で *scale されるため
      // scaleに依存しない一定のピクセル量として計算できる
      const zSpanPixels = (maxFloor - minFloor) * this.floorSpacing * Math.cos(this.angleZ);
      verticalCenterAdjust = zSpanPixels / 2;
    }
    return {
      x: this.canvas.width / 2,
      y: this.canvas.height / 2 + verticalCenterAdjust
    };
  }

  /** 指定したoffsetX/offsetYを使って3D座標を投影する（this.offsetX/Yを書き換えずに試算したい場合に使う） */
  projectWithOffsets(x, y, z, ox, oy) {
    const cx = x - this.totalWidth / 2;
    const cy = y - this.totalHeight / 2;

    const rotX = cx * Math.cos(this.angleX) - cy * Math.sin(this.angleX);
    const rotY = cx * Math.sin(this.angleX) + cy * Math.cos(this.angleX);

    const screenX = ox + rotX * this.scale;
    const screenY = oy + (rotY * Math.sin(this.angleZ) - z * Math.cos(this.angleZ)) * this.scale;

    return { x: screenX, y: screenY };
  }

  bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isRotating = true;
      this.dragMoved = false;
      this.rotStart = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isRotating) return;
      const dx = e.clientX - this.rotStart.x;
      const dy = e.clientY - this.rotStart.y;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        this.dragMoved = true;
      }

      this.angleX += dx * 0.005;
      this.angleZ += dy * 0.005;

      // 角度制限
      this.angleZ = Math.max(0.1, Math.min(Math.PI / 2.2, this.angleZ));

      this.rotStart = { x: e.clientX, y: e.clientY };
      this.render();
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isRotating && !this.dragMoved) {
        // ドラッグ（回転操作）ではなく単純クリックだった場合のみフロア選択として扱う
        this.handleClick(e);
      }
      this.isRotating = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoom = e.deltaY < 0 ? 1.1 : 0.9;
      this.scale = Math.max(0.002, Math.min(0.03, this.scale * zoom));
      this.render();
    }, { passive: false });

    // --- タッチ操作（スマホ／タブレット向け） ---
    // 1本指ドラッグ = 回転（マウスドラッグと同じ挙動）
    // 2本指ドラッグ／ピンチ = パン移動／ズーム
    // これまでこのCanvasには mousedown/mousemove/mouseup/wheel しか登録されておらず、
    // タッチイベントが一切無かったため、Android/iOSでは回転もパン／ズームも反応しなかった。
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();

      if (e.touches.length === 1) {
        this.pinchState = null;
        this.isRotating = true;
        this.dragMoved = false;
        this.rotStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        this.isRotating = false;
        const [t1, t2] = e.touches;
        this.pinchState = {
          startDist: this.touchDistance(t1, t2),
          startScale: this.scale,
          startMidX: (t1.clientX + t2.clientX) / 2,
          startMidY: (t1.clientY + t2.clientY) / 2,
          startPanX: this.panOffsetX,
          startPanY: this.panOffsetY,
        };
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();

      if (this.pinchState && e.touches.length === 2) {
        const [t1, t2] = e.touches;
        const dist = this.touchDistance(t1, t2);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;

        const newScale = this.pinchState.startScale * (dist / this.pinchState.startDist);
        this.scale = Math.max(0.002, Math.min(0.03, newScale));

        this.panOffsetX = this.pinchState.startPanX + (midX - this.pinchState.startMidX);
        this.panOffsetY = this.pinchState.startPanY + (midY - this.pinchState.startMidY);

        this.render();
        return;
      }

      if (this.isRotating && e.touches.length === 1) {
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const dx = currentX - this.rotStart.x;
        const dy = currentY - this.rotStart.y;

        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          this.dragMoved = true;
        }

        this.angleX += dx * 0.005;
        this.angleZ += dy * 0.005;

        // 角度制限
        this.angleZ = Math.max(0.1, Math.min(Math.PI / 2.2, this.angleZ));

        this.rotStart = { x: currentX, y: currentY };
        this.render();
      }
    }, { passive: false });

    const endTouch = (e) => {
      // 指を全て離した時点で、ドラッグ（回転操作）ではなく単純タップだった場合のみ
      // フロア選択として扱う（mouseupのクリック判定と同じロジック）。
      if (e.touches.length === 0) {
        if (this.isRotating && !this.dragMoved) {
          const t = e.changedTouches && e.changedTouches[0];
          if (t) this.handleClick(t);
        }
        this.isRotating = false;
        this.pinchState = null;
      } else if (e.touches.length === 1) {
        // 2本指→1本指に減った場合は、そのまま回転操作として引き継ぐ
        this.pinchState = null;
        this.isRotating = true;
        this.dragMoved = false;
        this.rotStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    this.canvas.addEventListener('touchend', endTouch, { passive: false });
    this.canvas.addEventListener('touchcancel', endTouch, { passive: false });
  }

  /** 2本指タッチ間の距離（ピンチズームの基準値算出用） */
  touchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  handleClick(e) {
    if (!this.onFloorClick) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // 上の階から順に判定（後から描画された＝画面上手前の階を優先）
    for (let i = this._floorHitAreas.length - 1; i >= 0; i--) {
      const area = this._floorHitAreas[i];
      if (this.pointInPolygon(px, py, area.points)) {
        this.onFloorClick(area.floor);
        return;
      }
    }
  }

  pointInPolygon(px, py, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi + Number.EPSILON) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // 3D mm座標 -> 2D Screen 座標 (Isometric Transform)
  isoProject(x, y, z) {
    return this.projectWithOffsets(x, y, z, this.offsetX, this.offsetY);
  }

  render() {
    // 回転中心（＝建物全体の鉛直方向の中心）が常にキャンバス中央付近にくるよう、
    // 現在の傾き(angleZ)に応じてoffsetを毎フレーム計算し直す。
    const base = this.computeBaseOffsets();
    this.offsetX = base.x + this.panOffsetX;
    this.offsetY = base.y + this.panOffsetY;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._floorHitAreas = [];

    // 1階から6階まで下から順に描画 (Zソート)
    const floors = [...this.floorsData].sort((a, b) => a.floor - b.floor);
    floors.forEach(floorData => {
      if (this.singleFloorNumber !== null && floorData.floor !== this.singleFloorNumber) {
        return;
      }
      const zHeight = this.singleFloorNumber !== null
        ? 0
        : (floorData.floor - 1) * this.floorSpacing / this.scale;
      this.renderFloorPlate(floorData, zHeight);
    });
  }

  renderFloorPlate(floorData, zHeight) {
    const outline = floorData.building_outline;

    if (outline && outline.length > 0) {
      const projected = outline.map(p => this.isoProject(p[0], p[1], zHeight));

      // 床スラブベースプレート（実際の建物外形ポリゴンをそのまま使用）
      this.ctx.beginPath();
      projected.forEach((pt, idx) => {
        if (idx === 0) this.ctx.moveTo(pt.x, pt.y);
        else this.ctx.lineTo(pt.x, pt.y);
      });
      this.ctx.closePath();

      this.ctx.fillStyle = 'rgba(30, 41, 59, 0.45)';
      this.ctx.fill();

      // 検索結果でハイライト中の部屋があるフロアは、建物外形を白く強調して
      // どの階を見ているか分かりやすくする（通常は薄い水色の枠線）
      const isHighlightFloor = this.highlightTarget && this.highlightTarget.floor === floorData.floor;
      this.ctx.strokeStyle = isHighlightFloor ? 'rgba(255, 255, 255, 0.95)' : 'rgba(56, 189, 248, 0.5)';
      this.ctx.lineWidth = isHighlightFloor ? 2.5 : 1.5;
      this.ctx.stroke();

      // クリック判定用にこのフロアのスクリーン座標ポリゴンを記録
      this._floorHitAreas.push({ floor: floorData.floor, points: projected });

      // フロアラベル（建物外形の左下外側）
      let minX = Infinity, maxY = -Infinity;
      outline.forEach(p => {
        if (p[0] < minX) minX = p[0];
        if (p[1] > maxY) maxY = p[1];
      });
      if (isFinite(minX) && isFinite(maxY)) {
        const labelPos = this.isoProject(minX - 2000, maxY, zHeight);
        this.ctx.fillStyle = '#38bdf8';
        this.ctx.font = 'bold 14px sans-serif';
        this.ctx.fillText(`${floorData.floor}F`, labelPos.x, labelPos.y);
      }
    }

    // 各部屋を高さを持った立体的な「箱（3Dブロック）」として描き出し（羽田空港マップ風の作図法）
    (floorData.rooms || []).forEach(room => {
      const poly = room.polygon_mm;
      if (!poly || poly.length === 0) return;

      const fallback = this.categoryColors[room.category] || { fill: 'rgba(148, 163, 184, 0.45)', stroke: '#94a3b8' };
      const fillColor = room.fillColor || fallback.fill;
      const strokeColor = room.strokeColor || fallback.stroke;

      const isHighlighted = !!(this.highlightTarget &&
        this.highlightTarget.floor === floorData.floor &&
        room.room_id === this.highlightTarget.roomId);

      const topPts = this.renderExtrudedRoomBox(room, poly, zHeight, fillColor, strokeColor, isHighlighted);

      // 階段・トイレ・EVのアイコン、部屋番号ラベルを天面上に描画
      if (room.icon) {
        const centerMm = room.center_point_mm || this.polygonCentroid(poly);
        const iconPos = this.isoProject(centerMm[0], centerMm[1], zHeight + (this.singleFloorNumber !== null ? 1200 : 900));
        this.drawRoomIcon(iconPos, room.icon);
      }
    });

    this.drawRouteForFloor(floorData, zHeight);

    // 出入口ラベル（例: 1Fの東正面入口・西入口）。app.js側で該当フロアにのみ
    // floorData.entrances がセットされている。他の描画物より最前面に出したいため
    // 部屋描画のあとに描く。
    if (floorData.entrances && floorData.entrances.length > 0) {
      floorData.entrances.forEach(ent => {
        if (!ent || !ent.position_mm) return;
        const pos = this.isoProject(ent.position_mm[0], ent.position_mm[1], zHeight + 900);
        this.drawEntranceMarker(pos, ent.label);
      });
    }
  }

  /**
   * 部屋ポリゴンを高さを持った立体的な「箱（3D Extruded Block）」として描画する。
   * 羽田空港フロアマップのような立ち上がり壁（側面シェーディング）と上面で構成。
   */
  renderExtrudedRoomBox(room, poly, zHeight, fillColor, strokeColor, isHighlighted) {
    const wallHeight = this.singleFloorNumber !== null ? 550 : 420; // 部屋の壁の高さ (mm)
    const zBase = zHeight + 60;
    const zTop = zBase + wallHeight;

    const basePts = poly.map(p => this.isoProject(p[0], p[1], zBase));
    const topPts = poly.map(p => this.isoProject(p[0], p[1], zTop));
    const n = poly.length;

    // 1. 側面壁 (Side Faces / Walls) の描画（手前・横の壁にリアルな影を付与）
    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      const b1 = basePts[i];
      const b2 = basePts[nextIdx];
      const t2 = topPts[nextIdx];
      const t1 = topPts[i];

      const dx = b2.x - b1.x;
      const dy = b2.y - b1.y;

      let shadowFactor = 0.28;
      if (dy > 0) shadowFactor += 0.16; // 下向きの壁
      if (dx > 0) shadowFactor += 0.10; // 右向きの壁

      this.ctx.beginPath();
      this.ctx.moveTo(b1.x, b1.y);
      this.ctx.lineTo(b2.x, b2.y);
      this.ctx.lineTo(t2.x, t2.y);
      this.ctx.lineTo(t1.x, t1.y);
      this.ctx.closePath();

      this.ctx.fillStyle = fillColor;
      this.ctx.fill();
      this.ctx.fillStyle = `rgba(15, 23, 42, ${shadowFactor.toFixed(2)})`;
      this.ctx.fill();

      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = 0.6;
      this.ctx.stroke();
    }

    // 2. 上面 (Top Face / Roof) の描画
    const drawTopPath = () => {
      this.ctx.beginPath();
      topPts.forEach((pt, idx) => {
        if (idx === 0) this.ctx.moveTo(pt.x, pt.y);
        else this.ctx.lineTo(pt.x, pt.y);
      });
      this.ctx.closePath();
    };

    if (room.strokeHalo) {
      drawTopPath();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      this.ctx.lineWidth = 2.2;
      this.ctx.stroke();
    }

    drawTopPath();
    this.ctx.fillStyle = fillColor;
    this.ctx.fill();
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = 0.9;
    this.ctx.stroke();

    if (room.strokeColor2) {
      drawTopPath();
      this.ctx.save();
      this.ctx.setLineDash([3, 3]);
      this.ctx.strokeStyle = room.strokeColor2;
      this.ctx.lineWidth = 0.9;
      this.ctx.stroke();
      this.ctx.restore();
    }

    if (isHighlighted) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260);
      drawTopPath();
      this.ctx.save();
      this.ctx.fillStyle = `rgba(239, 68, 68, ${(0.35 + 0.35 * pulse).toFixed(3)})`;
      this.ctx.fill();
      this.ctx.strokeStyle = '#ef4444';
      this.ctx.lineWidth = 2.5 + 1.2 * pulse;
      this.ctx.shadowColor = 'rgba(239, 68, 68, 0.9)';
      this.ctx.shadowBlur = 10 + 14 * pulse;
      this.ctx.stroke();
      this.ctx.restore();
    }

    return topPts;
  }

  drawEntranceMarker(screenPos, label) {
    if (!label) return;
    const ctx = this.ctx;
    ctx.save();

    // 位置を示す緑の丸マーカー
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();

    // マーカーの少し上にラベルバッジを表示
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(label).width;
    const boxW = textWidth + 14;
    const boxH = 18;
    const labelY = screenPos.y - 16;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
    ctx.lineWidth = 1;
    ctx.fillRect(screenPos.x - boxW / 2, labelY - boxH / 2, boxW, boxH);
    ctx.strokeRect(screenPos.x - boxW / 2, labelY - boxH / 2, boxW, boxH);

    ctx.fillStyle = '#4ade80';
    ctx.fillText(label, screenPos.x, labelY);

    ctx.restore();
  }

  /** ポリゴン（mm座標配列）の重心を計算する。room.center_point_mmが無い場合のフォールバック用。 */
  polygonCentroid(points) {
    const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
  }

  /**
   * 階段・トイレ・EVアイコンを描画する（スクリーン座標基準の固定サイズで、絵文字が使えない
   * 環境でも崩れないよう階段だけは自前のピクトグラムを描く。2D編集画面のgetRoomIconMetaと対応）。
   * @param {{x:number, y:number}} screenPos
   * @param {{kind:string, glyph?:string, glyphs?:string[], title?:string}} meta
   */
  drawRoomIcon(screenPos, meta) {
    if (!meta) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (meta.kind === 'emoji') {
      ctx.font = '18px sans-serif';
      ctx.fillText(meta.glyph, screenPos.x, screenPos.y);
    } else if (meta.kind === 'emoji-group') {
      ctx.font = '15px sans-serif';
      const spacing = 15;
      const totalWidth = spacing * (meta.glyphs.length - 1);
      const startX = screenPos.x - totalWidth / 2;
      meta.glyphs.forEach((glyph, i) => {
        ctx.fillText(glyph, startX + i * spacing, screenPos.y);
      });
    } else if (meta.kind === 'stairs') {
      const size = 16;
      const half = size / 2;
      ctx.translate(screenPos.x - half, screenPos.y - half);
      ctx.beginPath();
      ctx.moveTo(0, size);
      ctx.lineTo(0, size * 0.75);
      ctx.lineTo(size * 0.25, size * 0.75);
      ctx.lineTo(size * 0.25, size * 0.5);
      ctx.lineTo(size * 0.5, size * 0.5);
      ctx.lineTo(size * 0.5, size * 0.25);
      ctx.lineTo(size * 0.75, size * 0.25);
      ctx.lineTo(size * 0.75, 0);
      ctx.lineTo(size, 0);
      ctx.lineTo(size, size);
      ctx.closePath();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }
}
