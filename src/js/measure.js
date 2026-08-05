/**
 * B3 Building Distance Measurement Tool
 * 2D平面図上の任意の2点間寸法リアルタイム計測モジュール
 */
export class MeasureTool {
  constructor(svgElement, renderer) {
    this.svg = svgElement;
    this.renderer = renderer;
    this.active = false;
    this.points = [];
    this.tempPoint = null;

    this.gMeasure = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gMeasure.setAttribute('id', 'measure-overlay-group');
    this.svg.appendChild(this.gMeasure);

    this.bindEvents();
  }

  toggleActive() {
    this.active = !this.active;
    this.reset();
    this.svg.style.cursor = this.active ? 'crosshair' : 'grab';
    return this.active;
  }

  reset() {
    this.points = [];
    this.tempPoint = null;
    this.gMeasure.innerHTML = '';
  }

  bindEvents() {
    this.svg.addEventListener('click', (e) => {
      if (!this.active) return;
      
      const worldPt = this.renderer.clientToWorld(e.clientX, e.clientY);
      this.points.push(worldPt);

      if (this.points.length === 2) {
        this.renderMeasurement(this.points[0], this.points[1], true);
        this.points = []; // 完了後リセット
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.active || this.points.length !== 1) return;
      this.tempPoint = this.renderer.clientToWorld(e.clientX, e.clientY);
      this.renderTempLine();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active) {
        this.toggleActive();
      }
    });
  }

  renderTempLine() {
    if (!this.points[0] || !this.tempPoint) return;
    this.gMeasure.innerHTML = '';
    this.renderMeasurement(this.points[0], this.tempPoint, false);
  }

  renderMeasurement(p1, p2, isFinal) {
    const totalH = 54000; // GRID_CONFIG.totalHeight
    const svgY1 = totalH - p1.y;
    const svgY2 = totalH - p2.y;

    // 距離計算 (mm)
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const distanceMm = Math.round(Math.sqrt(dx * dx + dy * dy));
    const distanceM = (distanceMm / 1000).toFixed(2);

    // ライン描画
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', svgY1);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', svgY2);
    line.setAttribute('stroke', isFinal ? '#ef4444' : '#f59e0b');
    line.setAttribute('stroke-width', '250');
    line.setAttribute('stroke-dasharray', isFinal ? 'none' : '400 400');
    this.gMeasure.appendChild(line);

    // 端点ピン
    [ {x: p1.x, y: svgY1}, {x: p2.x, y: svgY2} ].forEach(pt => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pt.x);
      circle.setAttribute('cy', pt.y);
      circle.setAttribute('r', '400');
      circle.setAttribute('fill', isFinal ? '#ef4444' : '#f59e0b');
      this.gMeasure.appendChild(circle);
    });

    // 距離ラベル
    const midX = (p1.x + p2.x) / 2;
    const midY = (svgY1 + svgY2) / 2;

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', midX - 2500);
    bgRect.setAttribute('y', midY - 600);
    bgRect.setAttribute('width', '5000');
    bgRect.setAttribute('height', '1200');
    bgRect.setAttribute('rx', '300');
    bgRect.setAttribute('fill', '#0f172a');
    bgRect.setAttribute('stroke', isFinal ? '#ef4444' : '#f59e0b');
    bgRect.setAttribute('stroke-width', '100');
    this.gMeasure.appendChild(bgRect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', midX);
    text.setAttribute('y', midY);
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', '650');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.textContent = `${distanceM} m (${distanceMm} mm)`;
    this.gMeasure.appendChild(text);
  }
}
