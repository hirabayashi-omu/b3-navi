/**
 * B3 Building Floorplan SVG Renderer
 * ミリメートル座標系ベースの2D平面図高精度SVGレンダラー
 */
import { GRID_CONFIG } from '../data/grid_config.js';
import { FLOORS_DATA, ROOM_TYPE_COLORS } from '../data/floors_data.js';

export class FloorplanRenderer {
  constructor(svgElement, options = {}) {
    this.svg = svgElement;
    this.currentFloor = 1;
    this.onRoomSelect = options.onRoomSelect || null;
    this.onPointerMove = options.onPointerMove || null;

    // レイヤー表示フラグ
    this.layers = {
      cadBg: true,
      grid: true,
      rooms: true,
      labels: true,
      shearWalls: true,
      outerWalls: true,
      outdoor: false // デフォルトで建物外の表示物を非表示
    };

    this.cadImageOpacity = 0.45; // デフォルト背景透過率 45%
    
    // 背景CAD図面の位置・スケール微調整（キャリブレーション）パラメータ
    this.bgTransform = {
      offsetX: 0, // mm
      offsetY: 0, // mm
      scaleX: 1.0,
      scaleY: 1.0
    };

    // マージンを設定して ViewBox を初期化
    this.margin = 5500; // mm
    this.viewBox = {
      x: -this.margin,
      y: -this.margin,
      w: GRID_CONFIG.totalWidth + this.margin * 2,
      h: GRID_CONFIG.totalHeight + this.margin * 2
    };

    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.selectedRoomId = null;

    this.init();
  }

  init() {
    this.svg.innerHTML = '';
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.updateSvgViewBox();

    this.gMain = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gMain.setAttribute('id', 'main-floor-group');
    this.svg.appendChild(this.gMain);

    this.bindEvents();
    this.renderFloor(this.currentFloor);
  }

  updateSvgViewBox() {
    const vx = this.viewBox.x - this.panX;
    const vy = this.viewBox.y - this.panY;
    const vw = this.viewBox.w / this.scale;
    const vh = this.viewBox.h / this.scale;
    this.svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  }

  bindEvents() {
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.zoomAt(e.clientX, e.clientY, zoomFactor);
    }, { passive: false });

    this.svg.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = (e.clientX - this.dragStart.x) * (this.viewBox.w / this.svg.clientWidth) / this.scale;
        const dy = (e.clientY - this.dragStart.y) * (this.viewBox.h / this.svg.clientHeight) / this.scale;
        
        this.panX += dx;
        this.panY += dy;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.updateSvgViewBox();
      }

      if (this.onPointerMove) {
        const pt = this.clientToWorld(e.clientX, e.clientY);
        this.onPointerMove(pt);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  clientToWorld(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const svgX = clientX - rect.left;
    const svgY = clientY - rect.top;

    const vx = this.viewBox.x - this.panX;
    const vy = this.viewBox.y - this.panY;
    const vw = this.viewBox.w / this.scale;
    const vh = this.viewBox.h / this.scale;

    const worldX = vx + (svgX / rect.width) * vw;
    const worldY = GRID_CONFIG.totalHeight - (vy + (svgY / rect.height) * vh);

    return {
      x: Math.round(worldX),
      y: Math.round(worldY)
    };
  }

  zoomAt(clientX, clientY, factor) {
    const newScale = Math.max(0.3, Math.min(15.0, this.scale * factor));
    if (newScale === this.scale) return;

    this.scale = newScale;
    this.updateSvgViewBox();
  }

  resetView() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.updateSvgViewBox();
  }

  setLayerVisibility(layerKey, visible) {
    this.layers[layerKey] = visible;
    const elem = this.gMain.querySelector(`.layer-${layerKey}`);
    if (elem) {
      elem.style.display = visible ? 'inline' : 'none';
    }
  }

  async renderFloor(floorNum) {
    this.currentFloor = floorNum;
    this.gMain.innerHTML = '';

    if (!this.rawVectorSvg) {
      try {
        const resp = await fetch('b3_floor_vector.svg');
        this.rawVectorSvg = await resp.text();
      } catch (err) {
        console.error('Failed to load b3_floor_vector.svg', err);
      }
    }

    if (this.rawVectorSvg) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(this.rawVectorSvg, 'image/svg+xml');
      const svgRoot = doc.querySelector('svg');
      if (svgRoot) {
        const gVector = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gVector.setAttribute('class', 'layer-rawVector');
        Array.from(svgRoot.childNodes).forEach(node => {
          if (node.nodeName !== 'style' && node.nodeName !== 'defs') {
            gVector.appendChild(node.cloneNode(true));
          }
        });
        this.gMain.appendChild(gVector);
      }
    }

    // Set viewBox focusing on the requested floor outline in b3_floor_vector.svg
    const floorsMap = {
      1: { x: 155, y: 448, w: 236, h: 262 },
      2: { x: 509, y: 448, w: 236, h: 262 },
      3: { x: 863, y: 448, w: 236, h: 262 },
      4: { x: 155, y: 100, w: 236, h: 265 },
      5: { x: 509, y: 100, w: 236, h: 265 },
      6: { x: 863, y: 100, w: 236, h: 265 }
    };

    const targetView = floorsMap[floorNum] || floorsMap[1];
    this.viewBox = {
      x: targetView.x,
      y: targetView.y,
      w: targetView.w,
      h: targetView.h
    };
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.updateSvgViewBox();
  }

  renderCadBg(container, floorNum) {
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', `assets/floor_${floorNum}.png`);
    
    const w = GRID_CONFIG.totalWidth * this.bgTransform.scaleX;
    const h = GRID_CONFIG.totalHeight * this.bgTransform.scaleY;
    const x = this.bgTransform.offsetX;
    const y = this.bgTransform.offsetY;

    img.setAttribute('x', x);
    img.setAttribute('y', y);
    img.setAttribute('width', w);
    img.setAttribute('height', h);
    img.setAttribute('opacity', this.cadImageOpacity);
    img.setAttribute('preserveAspectRatio', 'none');
    img.setAttribute('id', 'cad-bg-image');
    container.appendChild(img);
  }

  setCadImageOpacity(opacity) {
    this.cadImageOpacity = opacity;
    const img = this.svg.querySelector('#cad-bg-image');
    if (img) {
      img.setAttribute('opacity', opacity);
    }
  }

  updateCadBgTransform(offsetX, offsetY, scale) {
    this.bgTransform.offsetX = offsetX;
    this.bgTransform.offsetY = offsetY;
    this.bgTransform.scaleX = scale;
    this.bgTransform.scaleY = scale;

    const img = this.svg.querySelector('#cad-bg-image');
    if (img) {
      const w = GRID_CONFIG.totalWidth * scale;
      const h = GRID_CONFIG.totalHeight * scale;
      img.setAttribute('x', offsetX);
      img.setAttribute('y', offsetY);
      img.setAttribute('width', w);
      img.setAttribute('height', h);
    }
  }

  createLayerGroup(name) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `layer-${name}`);
    g.style.display = this.layers[name] ? 'inline' : 'none';
    this.gMain.appendChild(g);
    return g;
  }

  renderGrid(container) {
    const totalW = GRID_CONFIG.totalWidth;
    const totalH = GRID_CONFIG.totalHeight;
    const ext = 3000;

    // X軸通り芯 (縦線)
    GRID_CONFIG.xGrids.forEach(xGrid => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', xGrid.pos);
      line.setAttribute('y1', -ext);
      line.setAttribute('x2', xGrid.pos);
      line.setAttribute('y2', totalH + ext);
      line.setAttribute('class', 'svg-grid-line');
      container.appendChild(line);

      this.drawGridBubble(container, xGrid.pos, totalH + ext + 1000, xGrid.label);
      this.drawGridBubble(container, xGrid.pos, -ext - 1000, xGrid.label);
    });

    // Y軸通り芯 (横線)
    GRID_CONFIG.yGrids.forEach(yGrid => {
      const svgY = totalH - yGrid.pos;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', -ext);
      line.setAttribute('y1', svgY);
      line.setAttribute('x2', totalW + ext);
      line.setAttribute('y2', svgY);
      line.setAttribute('class', 'svg-grid-line');
      container.appendChild(line);

      this.drawGridBubble(container, -ext - 1000, svgY, yGrid.label);
      this.drawGridBubble(container, totalW + ext + 1000, svgY, yGrid.label);
    });
  }

  drawGridBubble(container, cx, cy, labelText) {
    const radius = 900;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', '#0f172a');
    circle.setAttribute('stroke', '#38bdf8');
    circle.setAttribute('stroke-width', '120');
    container.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', cx);
    text.setAttribute('y', cy);
    text.setAttribute('class', 'svg-grid-label');
    text.setAttribute('font-size', '750');
    text.textContent = labelText;
    container.appendChild(text);
  }

  renderOuterBoundary(container) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', 0);
    rect.setAttribute('y', 0);
    rect.setAttribute('width', GRID_CONFIG.totalWidth);
    rect.setAttribute('height', GRID_CONFIG.totalHeight);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#94a3b8');
    rect.setAttribute('stroke-width', '350');
    container.appendChild(rect);
  }

  renderShearWalls(container, walls) {
    if (!walls) return;
    const totalH = GRID_CONFIG.totalHeight;

    walls.forEach(wall => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const svgY = totalH - (wall.y + wall.height);
      rect.setAttribute('x', wall.x);
      rect.setAttribute('y', svgY);
      rect.setAttribute('width', wall.width);
      rect.setAttribute('height', wall.height);
      rect.setAttribute('class', 'svg-shear-wall');
      container.appendChild(rect);
    });
  }

  renderRooms(roomContainer, labelContainer, rooms) {
    const totalH = GRID_CONFIG.totalHeight;

    rooms.forEach(room => {
      const colorScheme = ROOM_TYPE_COLORS[room.type] || ROOM_TYPE_COLORS.classroom;
      const svgY = totalH - (room.y + room.h);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', room.x);
      rect.setAttribute('y', svgY);
      rect.setAttribute('width', room.w);
      rect.setAttribute('height', room.h);
      rect.setAttribute('fill', colorScheme.fill);
      rect.setAttribute('stroke', colorScheme.stroke);
      rect.setAttribute('class', 'svg-room-polygon');
      rect.setAttribute('data-id', room.id);

      if (this.selectedRoomId === room.id) {
        rect.classList.add('selected');
      }

      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectRoom(room);
      });

      roomContainer.appendChild(rect);

      // ラベルテキスト描画
      const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      textGroup.setAttribute('class', 'svg-room-text-group');

      const cx = room.x + room.w / 2;
      const cy = svgY + room.h / 2;

      // 部屋番号 (roomNo) & 部屋名 (name) の両方を確実・明瞭に表示
      const minDim = Math.min(room.w, room.h);
      if (minDim >= 1500) {
        const hasName = room.name && room.name !== room.roomNo;
        const fontSizeNo = Math.min(room.w * 0.18, room.h * 0.28, 650);
        
        if (fontSizeNo >= 180) {
          const tNo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          tNo.setAttribute('x', cx);
          tNo.setAttribute('y', hasName ? cy - fontSizeNo * 0.45 : cy);
          tNo.setAttribute('class', 'svg-room-text svg-room-no');
          tNo.setAttribute('font-size', fontSizeNo);
          tNo.setAttribute('font-weight', 'bold');
          tNo.textContent = room.roomNo;
          textGroup.appendChild(tNo);

          if (hasName) {
            const fontSizeName = Math.min(room.w * 0.12, room.h * 0.20, 420);
            if (fontSizeName >= 140) {
              const tName = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              tName.setAttribute('x', cx);
              tName.setAttribute('y', cy + fontSizeNo * 0.55);
              tName.setAttribute('class', 'svg-room-text svg-room-name');
              tName.setAttribute('font-size', fontSizeName);
              const maxChars = Math.max(4, Math.floor(room.w / (fontSizeName * 0.85)));
              tName.textContent = room.name.length > maxChars ? room.name.substring(0, maxChars - 1) + '…' : room.name;
              textGroup.appendChild(tName);
            }
          }
        }
      }

      labelContainer.appendChild(textGroup);
    });

    // 選択された部屋が存在する場合、ピン（マーカー）を中心に正確に表示
    this.renderSelectedPin(labelContainer);
  }

  renderSelectedPin(container) {
    if (!this.selectedRoomId) return;

    const floorData = FLOORS_DATA.find(f => f.floor === this.currentFloor);
    if (!floorData) return;

    const room = floorData.rooms.find(r => r.id === this.selectedRoomId);
    if (!room) return;

    const totalH = GRID_CONFIG.totalHeight;
    const svgY = totalH - (room.y + room.h);
    const cx = room.x + room.w / 2;
    const cy = svgY + room.h / 2;

    const pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pinGroup.setAttribute('class', 'svg-room-pin-marker');
    pinGroup.setAttribute('transform', `translate(${cx}, ${cy})`);

    // アニメーション波紋
    const ripple = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ripple.setAttribute('r', '1200');
    ripple.setAttribute('class', 'pin-ripple');
    pinGroup.appendChild(ripple);

    // ピン（ドロップ型パス）
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M 0 0 C -400 -600, -800 -1200, -800 -1800 A 800 800 0 1 1 800 -1800 C 800 -1200, 400 -600, 0 0 Z');
    path.setAttribute('fill', '#ef4444');
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '120');
    path.setAttribute('filter', 'drop-shadow(0 10px 15px rgba(0,0,0,0.5))');
    pinGroup.appendChild(path);

    // ピン内側のドット
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', '0');
    dot.setAttribute('cy', '-1800');
    dot.setAttribute('r', '320');
    dot.setAttribute('fill', '#ffffff');
    pinGroup.appendChild(dot);

    container.appendChild(pinGroup);
  }

  selectRoom(room) {
    this.selectedRoomId = room ? room.id : null;
    const polygons = this.svg.querySelectorAll('.svg-room-polygon');
    polygons.forEach(p => {
      if (p.getAttribute('data-id') === this.selectedRoomId) {
        p.classList.add('selected');
      } else {
        p.classList.remove('selected');
      }
    });

    // 既存のピンマーカーを再描画
    const labelLayer = this.gMain.querySelector('.layer-labels');
    if (labelLayer) {
      const oldPin = labelLayer.querySelector('.svg-room-pin-marker');
      if (oldPin) oldPin.remove();
      this.renderSelectedPin(labelLayer);
    }

    if (this.onRoomSelect) {
      this.onRoomSelect(room);
    }
  }

  focusRoom(roomId) {
    const floorData = FLOORS_DATA.find(f => f.floor === this.currentFloor);
    if (!floorData) return;

    const room = floorData.rooms.find(r => r.id === roomId);
    if (!room) return;

    this.selectRoom(room);

    const totalH = GRID_CONFIG.totalHeight;
    const svgY = totalH - (room.y + room.h);
    const roomCx = room.x + room.w / 2;
    const roomCy = svgY + room.h / 2;

    const centerTargetX = GRID_CONFIG.totalWidth / 2;
    const centerTargetY = totalH / 2;

    this.scale = 3.5;
    this.panX = centerTargetX - roomCx;
    this.panY = centerTargetY - roomCy;
    this.updateSvgViewBox();
  }
}
