import { B3_FLOORS_DATA } from '../data/b3_floors_data.js';
import { Stacked3DRenderer } from './view_3d.js';
import { GPSCalibration, GPSWatcher, getLatLngCenter, getMaxDistanceFromCenterMeters, isLatLngWithinDistance, latLngToLocalMeters } from './gps.js';
import { RoutePlanner, isStairRoom } from './pathfinding.js';

const LOCAL_STORAGE_KEY = 'B3_FLOORS_DATA_PERSISTED';

const CATEGORY_COLORS = {
  classroom: { fill: 'rgba(56, 189, 248, 0.35)', stroke: '#38bdf8', name: '講義室・演習室' },
  lab: { fill: 'rgba(16, 185, 129, 0.35)', stroke: '#10b981', name: '実験室・実習室' },
  research: { fill: 'rgba(245, 158, 11, 0.35)', stroke: '#f59e0b', name: '研究室・事務室' },
  office: { fill: 'rgba(168, 85, 247, 0.35)', stroke: '#a855f7', name: '控室・更衣室・保健室' },
  core: { fill: 'rgba(239, 68, 68, 0.35)', stroke: '#ef4444', name: '電気室・設備室' },
  corridor: { fill: 'rgba(148, 163, 184, 0.25)', stroke: '#64748b', name: 'ホール・廊下' },
  stair_elv: { fill: 'rgba(236, 72, 153, 0.35)', stroke: '#ec4899', name: '階段・エレベーター' },
  void: { fill: 'rgba(14, 165, 233, 0.45)', stroke: '#0284c7', name: '中庭・吹抜' }
};

// 部屋メタデータ「所属」ごとの枠色（部屋ポリゴンの stroke 色）定義。
// color2 を持つ項目（エレクトロニクス/応用専門）は緑/白の2色縞模様の枠線として描画する。
// halo を持つ項目（主事室・管理職＝黒）はダークテーマ背景でも視認できるよう、
// 黒枠の外側に白いハローを1枚重ねて描画する。
const AFFILIATION_COLORS = {
  energy_machine:        { name: 'エネルギー機械',            color: '#ef4444' },                    // 赤
  product_design:        { name: 'プロダクトデザイン',        color: '#eab308' },                    // 黄
  electronics:            { name: 'エレクトロニクス',          color: '#22c55e' },                    // 緑
  electronics_advanced:  { name: 'エレクトロニクス/応用専門', color: '#22c55e', color2: '#ffffff' },  // 緑／白
  intelligent_info:      { name: '知能情報',                  color: '#3b82f6' },                    // 青
  general_subjects:      { name: '一般科目',                  color: '#a855f7' },                    // 紫
  admin_office:          { name: '事務局',                    color: '#67e8f9' },                    // 水色
  chief_office:           { name: '主事室・管理職',            color: '#000000', halo: true },        // 黒
  other:                  { name: 'その他',                    color: '#94a3b8' }                     // グレー（デフォルト）
};

// 全階層立体表示用の設定（isoProject の中心基準として使う平面図全体のサイズ = SVG viewBox と同じ mm 値）
const STACK_VIEW_TOTAL_WIDTH = 48400;
const STACK_VIEW_TOTAL_HEIGHT = 54000;

// GPS現在地表示のキャリブレーション用：1F平面図に既に登録されている出入口
// （getEntrancesForFloor()のlabelと対応）の実世界GPS座標。
// この2点と、平面図上のposition_mm（building_outlineから動的に算出）を対応付けて
// GPS座標→平面図mm座標の変換を求める（詳細は src/js/gps.js 参照）。
const ENTRANCE_GPS_COORDS = {
  '東正面入口': { lat: 34.5452093010622, lng: 135.5050559263473 },
  '西入口': { lat: 34.54556499425641, lng: 135.50464219561889 }
};

// GPS現在地表示：指定したキャンパス周辺座標からこの距離(m)より離れている場合は、
// その場所では現在地表示を行わず自動キャンセルする。
// B3棟（高専）および周辺駅の正確な実測GPS緯度経度
const GPS_BUILDING_CENTER = { lat: 34.54539577338726, lng: 135.50487530677495 };
const GPS_CAMPUS_REFERENCE_POINTS = [
  { label: 'なかもず', lat: 34.55554014252072, lng: 135.50529373134475 },
  { label: '中百舌鳥', lat: 34.55554014252072, lng: 135.50529373134475 },
  { label: '白鷺', lat: 34.54992908073216, lng: 135.51344764656483 }
];
// GPS 範囲制限を緩和：キャンパス周辺の参考点からの許容マージンを大きくする。
const GPS_CAMPUS_MARGIN_M = 50000;

class FloorplanApp {
  constructor() {
    this.data = this.loadPersistedData();
    this.currentFloorNum = 1; // 現在「表示中」のフロア（検索結果の閲覧などで一時的に目的階へ切り替わる）
    // 利用者が実際に「今いる」と思われるフロア。フロアタブを手動でクリックした時だけ更新し、
    // 検索結果／ダイレクトリンクによる目的階への自動切り替え時は更新しない
    // （さもないと、経路探索の起点フロアが常に「表示中＝目的階」になってしまい、
    //  階段を経由する経路が正しく求まらなくなるため。詳細はupdateRoutePath()参照）。
    this.userFloorNum = 1;
    this.selectedRoomIds = new Set();
    this.searchPinRoomId = null; // 検索結果クリックで📍を落とす対象の部屋ID（平面図モードのみ使用）
    this.isRoomSelectedByDirectClick = false; // 平面図上の部屋を直接クリック/タップした時のみ true（検索の後は false）
    
    this.isAddRoomMode = false;
    this.isDrawingRoom = false;
    this.drawStartPt = null;
    this.is3DMode = false;
    this.renderer3D = null;

    // 検索モード（既定・閲覧専用）／編集モード（部屋データの追加・削除・属性変更が可能）の切り替え。
    // 人事異動や組織改編があった時だけ編集モードを使う想定で、通常は検索モードのまま起動する。
    this.isEditMode = false;

    // スマホ検索モード専用URL（?mobile=1）で開かれたかどうか。
    // trueの場合、画面幅に関わらず常にスマホ向けコンパクト検索UIで表示し、
    // 編集モードへの切り替えもできないようにする（誤操作防止・共有用途向け）。
    const urlParams = new URLSearchParams(window.location.search);
    const mobileParam = urlParams.get('mobile');
    this.forceMobileUI = mobileParam !== null && mobileParam !== '0' && mobileParam.toLowerCase() !== 'false';
    if (this.forceMobileUI) {
      this.isEditMode = false;
    }

    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.campusScale = 1.4;
    this.campusPanX = -1332;
    this.campusPanY = 162;
    this.isDragging = false;
    // 2本指ピンチズーム／2本指移動（タッチ操作）用の状態
    this.pinchState = null;
    // 1本指スクロール（ページ送り）を手動で再現するための状態
    // （touch-action: none によりブラウザの既定スクロールを無効化しているため）
    this.singleTouchState = null;
    // Ctrl(Windows)/Cmd(Mac)+ドラッグでパンした直後、部屋クリックによる
    // 選択トグルを1回だけ無効化するためのフラグ
    this.suppressNextRoomClick = false;
    // 平面図ドラッグ（パン）操作の基準値。mousedown時に、その時点のCTM(px→mm換算係数)
    // とともにセットされる（詳細はmousedownハンドラのコメント参照）。
    this.dragStartClientX = 0;
    this.dragStartClientY = 0;
    this.dragStartPanX = 0;
    this.dragStartPanY = 0;
    this.dragScaleX = 1;
    this.dragScaleY = 1;

    this.layerState = {
      buildingOutline: true,
      cadWalls: true,
      roomOutlines: true,
      roomNumbers: true,
      roomNames: true,
      roomTeachers: true,
      fillColors: true
    };

    // GPS現在地表示機能（基準点は1Fの登録済み出入口から自動算出。管理者操作は不要）
    this.gpsCalib = new GPSCalibration();
    this.isGpsTracking = false;
    this.gpsWatcher = new GPSWatcher({
      onUpdate: (fix) => this.handleGpsUpdate(fix),
      onError: (err) => this.handleGpsError(err)
    });
    this.lastGpsMm = null; // 直近のGPS現在地（平面図mm座標）。未測位時はnull
    this.lastGpsFix = null; // 直近のGPS現在地（緯度経度）。キャンパス付近地図の距離パネル用

    // 現在地→目的部屋の経路探索機能
    this.routePlanner = new RoutePlanner();
    this.isRouteVisible = true;
    this.lastRoute = null;
    this.routeStartEntrance = null;

    // campusモード：OMU.svgキャンパス地図表示時にtrue。B3フロア通常表示時はfalse。
    this.isCampusMode = false;

    // 俯瞰ビュー（斜め鳥瞰表示）モード時にtrue
    this.isBirdsEyeMode = false;

    this.categoryState = {};
    Object.keys(CATEGORY_COLORS).forEach(cat => {
      this.categoryState[cat] = true;
    });

    this.affiliationState = {};
    Object.keys(AFFILIATION_COLORS).forEach(aff => {
      this.affiliationState[aff] = true;
    });

    this.initDOM();
    this.bindEvents();
    this.updateMobileUIClass();
    this.renderCategoryFilters();
    this.renderAffiliationFilters();
    this.applyModeVisibility();
    this.calibrateGpsFromEntrances();
    this.renderFloor(1);
    this.resetZoom();
    // メール等に貼った部屋への直接リンクで開かれた場合、該当部屋を自動でハイライト表示する
    this.consumeDirectLinkFromURL();
  }

  loadPersistedData() {
    let loadedData = null;
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        console.log("Loaded persisted room edits from localStorage.");
        loadedData = JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to load from localStorage, falling back to default CAD data.", e);
    }

    if (!loadedData) {
      return JSON.parse(JSON.stringify(B3_FLOORS_DATA));
    }

    // デフォルトマスターデータ（B3_FLOORS_DATA）から教員名(teachers)や最新の部屋情報を照合・マージし、
    // 古い localStorage キャッシュによって教員名や基本情報が消失しないよう安全に復元・維持する。
    const defaultData = JSON.parse(JSON.stringify(B3_FLOORS_DATA));
    const defaultRoomMap = {};
    (defaultData.floors || []).forEach(f => {
      (f.rooms || []).forEach(r => {
        if (r.room_id) {
          defaultRoomMap[r.room_id] = r;
        }
      });
    });

    (loadedData.floors || []).forEach(f => {
      (f.rooms || []).forEach(r => {
        const defRoom = defaultRoomMap[r.room_id];
        if (defRoom) {
          // 教員名が空または未定義の場合はデフォルトデータから自動復元
          if (!r.teachers || r.teachers.length === 0) {
            if (defRoom.teachers && defRoom.teachers.length > 0) {
              r.teachers = defRoom.teachers;
            }
          }
          // トイレ等の公式名称・部屋名・部屋番号の最新デフォルト優先同期
          if (defRoom.room_name && (defRoom.room_name.includes('多目的') || !r.room_name)) {
            r.room_name = defRoom.room_name;
            r.display_label = defRoom.display_label || defRoom.room_name;
          } else {
            if (!r.room_name && defRoom.room_name) r.room_name = defRoom.room_name;
            if (!r.display_label && defRoom.display_label) r.display_label = defRoom.display_label;
          }
          if (!r.room_number && defRoom.room_number) r.room_number = defRoom.room_number;
          if (!r.display_number && defRoom.display_number) r.display_number = defRoom.display_number;
          if ((!r.affiliation || r.affiliation === 'other') && defRoom.affiliation) {
            r.affiliation = defRoom.affiliation;
          }
        }
      });
    });

    return loadedData;
  }

  savePersistedData() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.data));
      this.showSaveNotification();
    } catch (e) {
      console.error("Failed to save data to localStorage.", e);
    }
  }

  showSaveNotification() {
    const badge = document.getElementById('save-status');
    if (badge) {
      badge.style.borderColor = '#10b981';
      setTimeout(() => {
        badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }, 1000);
    }
  }

  resetToDefaultData() {
    if (!this.isEditMode) return;
    if (confirm("全ての追加・編集・結合データを消去し、初期CADデータにリセットしますか？")) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      this.data = JSON.parse(JSON.stringify(B3_FLOORS_DATA));
      this.selectedRoomIds.clear();
      this.renderFloor(this.currentFloorNum);
      alert("初期データにリセットしました。");
    }
  }

  /**
   * 検索モード（閲覧専用）と編集モード（部屋データの追加・削除・属性変更が可能）を切り替える。
   * 編集モードは人事異動・組織改編があった時だけ使う想定なので、切り替え時に一言確認する。
   */
  setMode(mode) {
    const wantsEdit = mode === 'edit';
    if (wantsEdit === this.isEditMode) return;

    if (wantsEdit) {
      // スマホ検索モード専用URL(?mobile=1)経由の場合は、常に検索モードのみで運用する
      if (this.forceMobileUI) return;
      const ok = confirm(
        '編集モードに切り替えます。\n' +
        '部屋の追加・結合・削除や、部屋番号・名前・属性の変更ができるようになります。\n\n' +
        '通常の部屋データは、人事異動や組織改編があった時以外は変更しないでください。\n' +
        '続けますか？'
      );
      if (!ok) return;
    } else {
      // 検索モードに戻る際は、進行中の編集操作を安全に終了しておく
      this.exitAddRoomMode();
      this.selectedRoomIds.clear();
    }

    this.isEditMode = wantsEdit;
    this.applyModeVisibility();
    this.renderHighlight();
    this.renderEditorCard();
  }

  /** 現在のモードに応じて、編集専用UI（部屋の追加・結合・削除、リセット、JSON入出力）の表示/非表示を切り替える。 */
  applyModeVisibility() {
    // body に現在のモードをクラスとして反映（CSS側のメディアクエリでモバイル時のレイアウト分岐に使用）
    document.body.classList.toggle('mode-search', !this.isEditMode);
    document.body.classList.toggle('mode-edit', this.isEditMode);
    if (this.btnModeSearch) this.btnModeSearch.classList.toggle('active', !this.isEditMode);
    if (this.btnModeEdit) this.btnModeEdit.classList.toggle('active', this.isEditMode);
    if (this.editOnlyElements) {
      this.editOnlyElements.forEach(el => {
        el.style.display = this.isEditMode ? '' : 'none';
      });
    }
    if (this.roomEditorSectionTitle) {
      this.roomEditorSectionTitle.textContent = this.isEditMode
        ? '✏️ 部屋情報・サイズ・属性の訂正'
        : '🔍 部屋の詳細情報';
    }
  }

  /**
   * スマホ検索モード専用リンク（?mobile=1）を生成する。
   * このリンクを開くと、画面幅に関わらず常にスマホ向けコンパクト検索UIで表示され、
   * 編集モードへの切り替えもできなくなる（誤操作防止・QRコードやチャット共有向け）。
   * 現在表示中のフロアも一緒に引き継ぐ。
   */
  buildMobileModeLink() {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('mobile', '1');
    url.searchParams.set('floor', this.currentFloorNum);
    url.searchParams.delete('room');
    return url.toString();
  }

  /** スマホ検索モード専用リンクをクリップボードにコピーする。 */
  async copyMobileModeLink(triggerEl) {
    const link = this.buildMobileModeLink();
    try {
      await navigator.clipboard.writeText(link);
      this.flashLinkCopyFeedback(triggerEl, '✅ コピーしました');
    } catch (e) {
      window.prompt('このリンクをコピーしてください（QRコード化やチャット共有に使えます）:', link);
    }
  }

  /**
   * キャンパス付近地図専用ダイレクトリンク（?campus=1&mobile=1）を生成する。
   * このリンクを開くと、画面幅に関わらず自動的にキャンパス付近地図モードで開かれる。
   */
  buildCampusDirectLink() {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('campus', '1');
    url.searchParams.set('mobile', '1');
    url.searchParams.delete('floor');
    url.searchParams.delete('room');
    return url.toString();
  }

  /** キャンパス付近地図専用ダイレクトリンクをクリップボードにコピーする。 */
  async copyCampusDirectLink(triggerEl) {
    const link = this.buildCampusDirectLink();
    try {
      await navigator.clipboard.writeText(link);
      this.flashLinkCopyFeedback(triggerEl, '✅');
    } catch (e) {
      window.prompt('このリンクをコピーしてください（QRコード化やチャット共有に使えます）:', link);
    }
  }

  /**
   * 指定した部屋への直接リンク（?floor=..&room=..&mobile=1）を生成する。
   * このリンクを開くと、該当フロアに切り替わり、部屋に📍が表示された状態になる。
   * メール等での共有・スマホでの閲覧を主目的とするため、常に ?mobile=1 を付与し、
   * 画面幅やPC/スマホを問わず常にスマホ向けコンパクト検索UI（検索モード固定）で開かれるようにする。
   */
  buildRoomDirectLink(floor, roomId) {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('floor', floor);
    url.searchParams.set('room', roomId);
    url.searchParams.set('mobile', '1');
    return url.toString();
  }

  /** 部屋の直接リンクをクリップボードにコピーし、押されたボタンに一時的なフィードバックを表示する。 */
  async copyRoomDirectLink(floor, roomId, triggerEl) {
    const link = this.buildRoomDirectLink(floor, roomId);
    try {
      await navigator.clipboard.writeText(link);
      this.flashLinkCopyFeedback(triggerEl, '✅ コピーしました');
    } catch (e) {
      // クリップボードAPIが使えない環境（http接続や権限拒否など）向けのフォールバック
      window.prompt('このリンクをコピーしてください（メール等に貼り付け可能です）:', link);
    }
  }

  flashLinkCopyFeedback(el, message) {
    if (!el) return;
    const original = el.dataset.originalLabel || el.textContent;
    el.dataset.originalLabel = original;
    el.textContent = message;
    el.disabled = true;
    setTimeout(() => {
      el.textContent = original;
      el.disabled = false;
    }, 1500);
  }

  /**
   * URLに ?floor=..&room=.. または ?campus=1 が含まれている場合（メール等から直接リンクで開いた場合）、
   * 該当フロアやキャンパス付近地図モードに切り替える。
   * floorパラメータが無い/誤っている場合は room_id から全フロアを検索してフォールバックする。
   */
  consumeDirectLinkFromURL() {
    const params = new URLSearchParams(window.location.search);
    const campusParam = params.get('campus');
    if (campusParam === '1' || campusParam === 'true') {
      this.setCampusMode(true);
      return;
    }

    const roomId = params.get('room');
    if (!roomId) {
      // 部屋指定は無いが、フロア指定だけある場合（スマホ検索モード専用リンクなど）はそのフロアを開く
      const floorParam = parseInt(params.get('floor'), 10);
      if (!Number.isNaN(floorParam) && this.data.floors.some(f => f.floor === floorParam)) {
        this.switchToFloor(floorParam);
      }
      return;
    }

    let targetFloor = null;
    let targetRoom = null;
    for (const floorObj of this.data.floors) {
      const found = floorObj.rooms.find(r => r.room_id === roomId);
      if (found) {
        targetFloor = floorObj.floor;
        targetRoom = found;
        break;
      }
    }
    if (!targetRoom) return;

    this.switchToFloor(targetFloor, targetRoom.room_id);
    const label = targetRoom.display_number || targetRoom.room_number || '';
    if (this.searchInput && label) {
      this.searchInput.value = label;
    }
  }

  initDOM() {
    this.svgCanvas = document.getElementById('svg-canvas');
    this.svgWorld = document.getElementById('svg-world');
    this.viewport = document.getElementById('viewport');

    this.layerBuilding = document.getElementById('layer-building-outline');
    this.layerCadWalls = document.getElementById('layer-cad-walls');
    this.layerRooms = document.getElementById('layer-rooms');
    this.layerPreview = document.getElementById('layer-preview');
    this.layerLabels = document.getElementById('layer-labels');
    this.layerHighlight = document.getElementById('layer-highlight');

    this.searchInput = document.getElementById('search-input');
    this.searchResults = document.getElementById('search-results');
    this.roomEditorCard = document.getElementById('room-editor-card');
    this.zoomIndicator = document.getElementById('zoom-indicator');

    this.btnAddRoom = document.getElementById('btn-add-room');
    this.addModeBanner = document.getElementById('add-mode-banner');
    this.btn3DView = document.getElementById('btn-3d-view');
    this.btnToggleRoute = document.getElementById('btn-toggle-route');
    this.canvas3D = document.getElementById('canvas-3d');
    this.btnCopyMobileLink = document.getElementById('btn-copy-mobile-link');

    // 検索モード／編集モード切り替えUI
    this.btnModeSearch = document.getElementById('btn-mode-search');
    this.btnModeEdit = document.getElementById('btn-mode-edit');
    // 編集モードの時だけ表示する要素（部屋の追加・結合・削除、リセット、JSON入出力など）
    this.editOnlyElements = document.querySelectorAll('.edit-only');
    this.roomEditorSectionTitle = document.getElementById('room-editor-section-title');

    // GPS現在地表示UI
    this.layerGpsLocation = document.getElementById('layer-gps-location');
    this.btnGpsLocate = document.getElementById('btn-gps-locate');

    // 現在地→目的部屋の経路表示レイヤー
    this.layerRoutePath = document.getElementById('layer-route-path');
    this.btnCampusMap = document.getElementById('btn-campus-map');
    this.btnCopyCampusLink = document.getElementById('btn-copy-campus-link');
    this.btnToggleBirdsEye = document.getElementById('btn-toggle-birds-eye');
    this.btnFabBirdsEye = document.getElementById('btn-fab-birds-eye');
    this.svgCampus = document.getElementById('svg-campus');
    this.svgCampusWorld = document.getElementById('svg-campus-world');
    this.campusDistancePanel = document.getElementById('campus-distance-panel');

    // ヘッダー左のタイトルバー（brand-title）。キャンパス地図モード中は
    // 通常のB3棟タイトルの代わりに「🏫 キャンパス地図」のタイトルへ差し替える
    // （setCampusMode()参照）。タイトルバー自体は隠さないことで、
    // 右側のheader-controls（切り替えボタン）の位置を常時同じに保つ。
    this.brandIcon = document.getElementById('brand-icon');
    this.brandHeading = document.getElementById('brand-heading');
    this.brandSubtitle = document.getElementById('brand-subtitle');
    this.defaultBrandIconText = this.brandIcon ? this.brandIcon.textContent : '';
    this.defaultBrandHeadingText = this.brandHeading ? this.brandHeading.textContent : '';
    this.defaultBrandSubtitleText = this.brandSubtitle ? this.brandSubtitle.textContent : '';
  }

  bindEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fNum = parseInt(btn.getAttribute('data-floor'), 10);
        this.switchToFloor(fNum);
      });
    });

    this.btn3DView.addEventListener('click', () => {
      this.toggle3DView();
    });

    if (this.btnToggleRoute) {
      this.btnToggleRoute.addEventListener('click', () => {
        this.toggleRouteVisibility();
      });
      this.btnToggleRoute.classList.add('active');
    }

    // GPS現在地表示ボタン
    this.btnGpsLocate.addEventListener('click', () => {
      this.toggleGpsTracking();
    });

    if (this.btnCampusMap) {
      this.btnCampusMap.addEventListener('click', () => {
        this.toggleCampusMode();
      });
    }

    if (this.btnToggleBirdsEye) {
      this.btnToggleBirdsEye.addEventListener('click', () => {
        this.toggleBirdsEyeMode();
      });
    }

    if (this.btnFabBirdsEye) {
      this.btnFabBirdsEye.addEventListener('click', () => {
        this.toggleBirdsEyeMode();
      });
    }

    if (this.btnCopyCampusLink) {
      this.btnCopyCampusLink.addEventListener('click', () => {
        this.copyCampusDirectLink(this.btnCopyCampusLink);
      });
    }

    if (this.btnCopyMobileLink) {
      this.btnCopyMobileLink.addEventListener('click', () => {
        this.copyMobileModeLink(this.btnCopyMobileLink);
      });
    }

    // 検索モード／編集モード切り替え
    this.btnModeSearch.addEventListener('click', () => {
      this.setMode('search');
    });
    this.btnModeEdit.addEventListener('click', () => {
      this.setMode('edit');
    });

    // 編集モードはPC専用（モバイル幅では編集モードUIごと非表示にしている）。
    // ウィンドウをモバイル幅まで縮めた場合は、確認ダイアログなしで検索モードへ自動的に戻す。
    // また、部屋番号・部屋名のフォントサイズはモバイル幅かどうかで変わるため、
    // ブレークポイントをまたいだ時だけラベルを再描画してサイズを追従させる。
    const MOBILE_BREAKPOINT = 1200;
    let lastIsMobile = this.isMobileViewport();
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      // 画面幅の変化に応じて .ui-mobile クラスを即座に同期する
      // （?mobile=1 で強制表示中の場合は常にモバイルUIのまま変わらない）
      this.updateMobileUIClass();

      if (this.isEditMode && this.isMobileViewport()) {
        this.isEditMode = false;
        this.exitAddRoomMode();
        this.selectedRoomIds.clear();
        this.applyModeVisibility();
        this.renderHighlight();
        this.renderEditorCard();
      }

      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const nowIsMobile = this.isMobileViewport();
        if (nowIsMobile !== lastIsMobile) {
          lastIsMobile = nowIsMobile;
          this.renderLabelsOnly();
        }
      }, 150);
    });

    window.addEventListener('orientationchange', () => {
      this.updateMobileUIClass();
      this.resetZoom();
      this.renderLabelsOnly();
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        this.updateMobileUIClass();
      });
    }

    document.getElementById('toggle-building-outline').addEventListener('change', (e) => {
      this.layerState.buildingOutline = e.target.checked;
      this.layerBuilding.style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('toggle-cad-walls').addEventListener('change', (e) => {
      this.layerState.cadWalls = e.target.checked;
      this.layerCadWalls.style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('toggle-room-outlines').addEventListener('change', (e) => {
      this.layerState.roomOutlines = e.target.checked;
      this.renderRoomsOnly();
    });
    document.getElementById('toggle-room-numbers').addEventListener('change', (e) => {
      this.layerState.roomNumbers = e.target.checked;
      this.renderLabelsOnly();
    });
    document.getElementById('toggle-room-names').addEventListener('change', (e) => {
      this.layerState.roomNames = e.target.checked;
      this.renderLabelsOnly();
    });
    document.getElementById('toggle-room-teachers').addEventListener('change', (e) => {
      this.layerState.roomTeachers = e.target.checked;
      this.renderLabelsOnly();
    });
    document.getElementById('toggle-fill-colors').addEventListener('change', (e) => {
      this.layerState.fillColors = e.target.checked;
      this.renderRoomsOnly();
    });

    // Action Buttons
    this.btnAddRoom.addEventListener('click', () => {
      this.toggleAddRoomMode();
    });
    document.getElementById('btn-merge-rooms').addEventListener('click', () => {
      this.mergeSelectedRooms();
    });
    document.getElementById('btn-delete-room').addEventListener('click', () => {
      this.deleteSelectedRooms();
    });

    // Reset & Export Buttons
    document.getElementById('btn-reset-data').addEventListener('click', () => {
      this.resetToDefaultData();
    });
    document.getElementById('btn-export-json').addEventListener('click', () => {
      this.exportJSON();
    });
    document.getElementById('btn-import-json').addEventListener('click', () => {
      document.getElementById('json-file-input').click();
    });
    document.getElementById('json-file-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        this.importJSON(file);
      }
      e.target.value = '';
    });

    this.searchInput.addEventListener('input', (e) => {
      this.handleSearch(e.target.value.trim());
    });

    this.searchInput.addEventListener('focus', (e) => {
      if (e.target.value.trim()) {
        this.handleSearch(e.target.value.trim());
      }
    });

    this.searchInput.addEventListener('click', (e) => {
      const q = e.target.value.trim();
      if (q && (!this.searchResults.children || this.searchResults.children.length === 0)) {
        this.handleSearch(q);
      }
    });

    const closeSearchIfOutside = (e) => {
      const sectionSearch = document.getElementById('section-search');
      if (sectionSearch && !sectionSearch.contains(e.target)) {
        this.collapseSearchResults();
      }
    };

    document.addEventListener('pointerdown', closeSearchIfOutside, { passive: true });
    document.addEventListener('click', closeSearchIfOutside, { passive: true });

    document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoom(1.2));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoom(0.8));
    document.getElementById('btn-zoom-reset').addEventListener('click', () => this.resetZoom());

    this.viewport.addEventListener('wheel', (e) => {
      if (e.target.closest('.floating-toolbar')) return;
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      if (this.isCampusMode) {
        this.campusZoom(zoomFactor);
      } else {
        this.zoom(zoomFactor);
      }
    }, { passive: false });

    this.viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.floating-toolbar')) return;
      if (this.isCampusMode) {
        this.isDragging = true;
        this.dragStartClientX = e.clientX;
        this.dragStartClientY = e.clientY;
        this.dragStartPanX = this.campusPanX;
        this.dragStartPanY = this.campusPanY;
        const dragCtm = this.svgCampus.getScreenCTM();
        this.dragScaleX = dragCtm ? dragCtm.a : 1;
        this.dragScaleY = dragCtm ? dragCtm.d : 1;
        return;
      }

      if (this.isAddRoomMode) {
        this.isDrawingRoom = true;
        this.drawStartPt = this.getSVGPoint(e.clientX, e.clientY);
        this.layerPreview.innerHTML = '';
        return;
      }

      // Ctrl(Windows)/Cmd(Mac)+ドラッグ：部屋ポリゴンの上から始めても
      // 選択状態を変えずに確実に平面図を移動できるようにする（通常のドラッグでも
      // 空白部分からなら従来どおりパンできるが、部屋の上だと選択トグルと競合しやすいため）。
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.suppressNextRoomClick = true;
      }

      this.isDragging = true;
      this.dragStartClientX = e.clientX;
      this.dragStartClientY = e.clientY;
      this.dragStartPanX = this.panX;
      this.dragStartPanY = this.panY;
      // 画面px と SVGビューポート座標(mm) の縮尺は viewBox とSVG要素の実表示サイズの比で
      // 決まり、両者は一致しない（viewBoxは48400x54000だが実表示は数百〜千数百px程度）。
      // 以前はドラッグの画面px移動量をそのままpanX/panYに加算していたため、
      // 実際の画面移動量が本来の数%程度しかなく、特にCtrl+ドラッグで
      // 「ほとんど動かない」と感じる不具合の原因になっていた。
      // getScreenCTM() で実際のpx→mm変換係数を取得し、ドラッグ量をそれに応じて換算する。
      const dragCtm = this.svgCanvas.getScreenCTM();
      this.dragScaleX = dragCtm ? dragCtm.a : 1;
      this.dragScaleY = dragCtm ? dragCtm.d : 1;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isAddRoomMode && this.isDrawingRoom && this.drawStartPt) {
        const curPt = this.getSVGPoint(e.clientX, e.clientY);
        const minX = Math.min(this.drawStartPt.x, curPt.x);
        const minY = Math.min(this.drawStartPt.y, curPt.y);
        const w = Math.abs(curPt.x - this.drawStartPt.x);
        const h = Math.abs(curPt.y - this.drawStartPt.y);

        this.layerPreview.innerHTML = `
          <rect x="${minX}" y="${minY}" width="${w}" height="${h}"
                fill="rgba(56, 189, 248, 0.4)" stroke="#38bdf8" stroke-width="400" stroke-dasharray="800,400" />
        `;
        return;
      }

      if (!this.isDragging) return;
      const dxPx = e.clientX - this.dragStartClientX;
      const dyPx = e.clientY - this.dragStartClientY;
      if (this.isCampusMode) {
        this.campusPanX = this.dragStartPanX + dxPx / (this.dragScaleX || 1);
        this.campusPanY = this.dragStartPanY + dyPx / (this.dragScaleY || 1);
      } else {
        this.panX = this.dragStartPanX + dxPx / (this.dragScaleX || 1);
        this.panY = this.dragStartPanY + dyPx / (this.dragScaleY || 1);
      }
      this.updateTransform();
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isAddRoomMode && this.isDrawingRoom && this.drawStartPt) {
        const curPt = this.getSVGPoint(e.clientX, e.clientY);
        const minX = Math.round(Math.min(this.drawStartPt.x, curPt.x));
        const minY = Math.round(Math.min(this.drawStartPt.y, curPt.y));
        let w = Math.round(Math.abs(curPt.x - this.drawStartPt.x));
        let h = Math.round(Math.abs(curPt.y - this.drawStartPt.y));

        this.isDrawingRoom = false;
        this.drawStartPt = null;
        this.layerPreview.innerHTML = '';

        if (w < 500) w = 8000;
        if (h < 500) h = 5000;

        this.createRoomWithBounds(minX, minY, w, h);
        return;
      }

      this.isDragging = false;
      // クリックイベント（この直後に同期的に発火する）でフラグが消費されなかった場合
      // （例：部屋の無い場所でCtrl+ドラッグを離した場合）に備えた保険的リセット。
      // setTimeoutでマクロタスクに回すことで、直後に発火するclickイベントの処理より後に実行される。
      if (this.suppressNextRoomClick) {
        setTimeout(() => { this.suppressNextRoomClick = false; }, 0);
      }
    });

    // --- タッチ操作：1本指スクロール／2本指ピンチでズーム／2本指ドラッグで移動 ---
    // CSS側で touch-action: none にしているため、ブラウザは一切スクロール／ズームを
    // 自動処理しない。そのため1本指スクロールも含めてすべてここでJS側から手動再現する。
    // タップ（指を動かさずに離す）は touchmove がほぼ発生しないため、
    // ここで preventDefault しても部屋タップ選択（clickイベント）には影響しない。
    this.viewport.addEventListener('touchstart', (e) => {
      if (e.target.closest('.floating-toolbar')) return;
      if (this.isAddRoomMode) return;
      // 3D表示中は canvas-3d 側（Stacked3DRenderer）が独自にタッチ操作（回転・パン・ズーム）
      // を処理するため、ここでは一切手を出さない。ここで処理してしまうと、非表示になっている
      // 2D平面図側の panX/panY やページスクロールが誤って動いてしまい、3D側のタッチ操作と
      // 競合して「反応しているのに何も起きない」ように見える不具合の原因になっていた。
      if (this.is3DMode) return;

      if (e.touches.length === 2) {
        e.preventDefault();
        const [t1, t2] = e.touches;
        // 画面px と SVGビューポート座標(mm) の縮尺変換係数。
        // これが無いと、2本指の移動量(px)をそのままpanX/panY(mm相当)に加算してしまい、
        // 実際の見た目の移動量が本来の数%程度しかない「ほとんど動かない」状態になる
        // （マウスドラッグ・1本指ドラッグでは元々この変換をしていたが、2本指ピンチの
        // パン計算だけ変換が抜けていたのが今回の不具合の原因）。
        const dragTarget = this.isCampusMode ? this.svgCampus : this.svgCanvas;
        const dragCtm = dragTarget.getScreenCTM();
        this.pinchState = {
          startDist: this.touchDistance(t1, t2),
          startScale: this.isCampusMode ? this.campusScale : this.scale,
          startMidX: (t1.clientX + t2.clientX) / 2,
          startMidY: (t1.clientY + t2.clientY) / 2,
          startPanX: this.isCampusMode ? this.campusPanX : this.panX,
          startPanY: this.isCampusMode ? this.campusPanY : this.panY,
          dragScaleX: dragCtm ? dragCtm.a : 1,
          dragScaleY: dragCtm ? dragCtm.d : 1,
        };
        this.singleTouchState = null;
      } else if (e.touches.length === 1) {
        // タップ判定を妨げないよう、この時点では preventDefault しない。
        // 以前はここで「縦方向のページスクロール」用の基準値だけを保持していたが、
        // スマホレイアウトでは平面図(.app-viewport)自体は固定サイズの箱で、
        // 実際にパンさせたいのは中のSVGの中身。ページをスクロールしても
        // 地図の中身は一切動かないため「平行移動できない」不具合の原因になっていた。
        // → デスクトップのマウスドラッグと同じロジックで、1本指ドラッグでも
        //   実際にSVG(panX/panY)をパンするようにする。
        const dragTarget = this.isCampusMode ? this.svgCampus : this.svgCanvas;
        const dragCtm = dragTarget.getScreenCTM();
        this.singleTouchState = {
          startClientX: e.touches[0].clientX,
          startClientY: e.touches[0].clientY,
          startPanX: this.isCampusMode ? this.campusPanX : this.panX,
          startPanY: this.isCampusMode ? this.campusPanY : this.panY,
          dragScaleX: dragCtm ? dragCtm.a : 1,
          dragScaleY: dragCtm ? dragCtm.d : 1,
          moved: false,
        };
        this.pinchState = null;
      }
    }, { passive: false });

    this.viewport.addEventListener('touchmove', (e) => {
      // 3D表示中は canvas-3d 側が処理するため、ここでは何もしない（上のtouchstart参照）。
      if (this.is3DMode) return;
      if (this.pinchState && e.touches.length === 2) {
        e.preventDefault();

        const [t1, t2] = e.touches;
        const dist = this.touchDistance(t1, t2);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;

        let newScale = this.pinchState.startScale * (dist / this.pinchState.startDist);
        newScale = Math.min(Math.max(0.2, newScale), 5.0);
        if (this.isCampusMode) {
          this.campusScale = newScale;
          this.campusPanX = this.pinchState.startPanX + (midX - this.pinchState.startMidX) / (this.pinchState.dragScaleX || 1);
          this.campusPanY = this.pinchState.startPanY + (midY - this.pinchState.startMidY) / (this.pinchState.dragScaleY || 1);
        } else {
          this.scale = newScale;
          this.panX = this.pinchState.startPanX + (midX - this.pinchState.startMidX) / (this.pinchState.dragScaleX || 1);
          this.panY = this.pinchState.startPanY + (midY - this.pinchState.startMidY) / (this.pinchState.dragScaleY || 1);
        }

        this.updateTransform();
        return;
      }

      if (this.singleTouchState && e.touches.length === 1) {
        // 実際に指が動いた（＝タップではなくドラッグ操作）ことが確定した時点で
        // preventDefault し、touch-action:none により無効化した既定のスクロールの
        // 代わりに、平面図(SVG)そのものをドラッグ量に応じてパンする。
        e.preventDefault();
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const dxPx = currentX - this.singleTouchState.startClientX;
        const dyPx = currentY - this.singleTouchState.startClientY;

        if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) {
          this.singleTouchState.moved = true;
        }

        this.panX = this.singleTouchState.startPanX + dxPx / (this.singleTouchState.dragScaleX || 1);
        this.panY = this.singleTouchState.startPanY + dyPx / (this.singleTouchState.dragScaleY || 1);
        this.updateTransform();
      }
    }, { passive: false });

    const endTouch = (e) => {
      if (e.touches.length < 2) {
        this.pinchState = null;
      }
      if (e.touches.length < 1) {
        this.singleTouchState = null;
      }
    };
    this.viewport.addEventListener('touchend', endTouch, { passive: true });
    this.viewport.addEventListener('touchcancel', endTouch, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isAddRoomMode) {
        this.exitAddRoomMode();
      }
    });

    this.svgCanvas.addEventListener('click', (e) => {
      if (this.isAddRoomMode) return;

      if (!e.target.classList.contains('room-poly')) {
        this.selectedRoomIds.clear();
        this.searchPinRoomId = null;
        this.renderHighlight();
        this.renderEditorCard();
      }
    });
  }

  switchToFloor(floorNum, roomIdToSelect) {
    const oldFloor = this.currentFloorNum;
    const diff = floorNum - oldFloor;

    if (this.isCampusMode) {
      this.setCampusMode(false);
    }
    if (this.is3DMode) {
      this.exit3DView();
    }
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.getAttribute('data-floor'), 10) === floorNum);
    });
    this.currentFloorNum = floorNum;
    if (!roomIdToSelect) {
      // フロアタブの手動クリック等、検索を介さない遷移＝利用者が実際にそのフロアにいる
      // （＝経路探索の起点フロアとして使う）とみなす。検索結果／ダイレクトリンクによる
      // 目的階への自動切り替え（roomIdToSelect指定あり）では更新しない。
      this.userFloorNum = floorNum;
    }
    this.selectedRoomIds.clear();
    this.exitAddRoomMode();
    this.searchPinRoomId = null;
    this.isRoomSelectedByDirectClick = false;
    if (roomIdToSelect) {
      this.selectedRoomIds.add(roomIdToSelect);
      // 検索結果から遷移してきた場合のみ📍を落とす対象として記録する
      this.searchPinRoomId = roomIdToSelect;
    }

    if (this.isBirdsEyeMode && this.renderer3D) {
      this.renderer3D.setSingleFloorMode(floorNum);
    }

    const animateFloor = diff !== 0 && this.svgCanvas && !this.svgCanvas.classList.contains('hidden');

    if (animateFloor) {
      if (this._floorTransitionTimer) {
        clearTimeout(this._floorTransitionTimer);
        this._floorTransitionTimer = null;
      }

      const directionClass = diff > 0 ? 'floor-transition-up' : 'floor-transition-down';
      
      this.svgCanvas.classList.remove('floor-transition-up', 'floor-transition-down', 'floor-transition-enter');
      this.svgCanvas.classList.add(directionClass);

      this._floorTransitionTimer = setTimeout(() => {
        this.renderFloor(floorNum);

        if (roomIdToSelect) {
          const floorObj = this.data.floors.find(f => f.floor === floorNum);
          const targetRoom = floorObj && floorObj.rooms.find(r => r.room_id === roomIdToSelect);
          if (targetRoom) {
            requestAnimationFrame(() => this.centerOnRoom(targetRoom));
          }
        }

        this.svgCanvas.classList.remove(directionClass);
        this.svgCanvas.classList.add('floor-transition-enter');

        setTimeout(() => {
          if (this.svgCanvas) this.svgCanvas.classList.remove('floor-transition-enter');
          this._floorTransitionTimer = null;
        }, 220);
      }, 110);
    } else {
      this.renderFloor(floorNum);
      if (roomIdToSelect) {
        const floorObj = this.data.floors.find(f => f.floor === floorNum);
        const targetRoom = floorObj && floorObj.rooms.find(r => r.room_id === roomIdToSelect);
        if (targetRoom) {
          requestAnimationFrame(() => this.centerOnRoom(targetRoom));
        }
      }
    }
  }

  toggleBirdsEyeMode() {
    this.setBirdsEyeMode(!this.isBirdsEyeMode);
  }

  setBirdsEyeMode(enabled) {
    this.isBirdsEyeMode = enabled;
    document.body.classList.toggle('view-birds-eye', enabled);
    if (this.btnFabBirdsEye) {
      this.btnFabBirdsEye.classList.toggle('active', enabled);
    }
    if (enabled && this.is3DMode) {
      this.exit3DView();
    }
    if (enabled && this.isCampusMode) {
      this.setCampusMode(false, false);
    }
  }

  toggleCampusMode() {
    if (this.is3DMode) {
      this.exit3DView();
    }
    this.setCampusMode(!this.isCampusMode, true);
  }

  setCampusMode(enabled, animate = true) {
    if (enabled && this.is3DMode) {
      this.exit3DView();
    }
    if (enabled && this.isBirdsEyeMode) {
      this.setBirdsEyeMode(false);
    }
    this.isCampusMode = enabled;
    this.isDragging = false;
    this.pinchState = null;
    this.singleTouchState = null;
    document.body.classList.toggle('campus-mode', enabled);
    if (this.btnCampusMap) {
      this.btnCampusMap.classList.toggle('active', enabled);
      // textContent を直接書き換えるとボタン内の label-full / label-short の
      // 2つの<span>構造が失われ、スマホ幅でアイコンのみに省略する挙動
      // （#btn-campus-map .label-short 関連のCSS）が効かなくなってしまう。
      // 「B3平面図」表示時も「キャンパス付近地図」表示時と全く同じ位置・同じ
      // デザイン・同一挙動（スマホでは🏫アイコンのみに省略）となるよう、
      // 各<span>のテキストのみを差し替える。
      this.btnCampusMap.title = enabled
        ? 'B3平面図表示に切り替えます'
        : 'キャンパス付近地図モードとB3平面図表示を切り替えます';
      const labelFull = this.btnCampusMap.querySelector('.label-full');
      const labelShort = this.btnCampusMap.querySelector('.label-short');
      if (labelFull) labelFull.textContent = enabled ? '👈 B3平面図' : '👉 キャンパス付近地図';
      if (labelShort) labelShort.textContent = enabled ? '👈' : '👉';
    }
    // タイトルバーの中身を、キャンパス地図用／通常のB3棟ナビ用に差し替える。
    // 要素自体は常に表示したままにすることで、header-controls側の位置がズレない。
    if (this.brandIcon && this.brandHeading && this.brandSubtitle) {
      if (enabled) {
        this.brandIcon.textContent = '🏫';
        this.brandHeading.textContent = 'キャンパス付近地図';
        this.brandSubtitle.textContent = 'B3棟の位置を含むキャンパス全体図です';
      } else {
        this.brandIcon.textContent = this.defaultBrandIconText;
        this.brandHeading.textContent = this.defaultBrandHeadingText;
        this.brandSubtitle.textContent = this.defaultBrandSubtitleText;
      }
    }
    this.updateGpsButtonVisibility();

    if (enabled) {
      // キャンパスモード時は、フロアタブを無効化してB3フロア表示を切り替えない。
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    }

    const entering = enabled ? this.svgCampus : (this.is3DMode ? this.canvas3D : this.svgCanvas);
    const leaving = enabled ? (this.is3DMode ? this.canvas3D : this.svgCanvas) : this.svgCampus;

    if (animate && entering && leaving) {
      this.animateViewTransition(entering, leaving, () => {
        if (enabled) {
          this.resetZoom();
          this.renderCampusDistancePanel();
        } else {
          this.renderFloor(this.currentFloorNum);
          this.resetZoom();
        }
      });
    } else {
      if (this.svgCampus) {
        this.svgCampus.classList.toggle('hidden', !enabled);
        this.svgCampus.classList.remove('map-transition-in', 'map-transition-out');
      }
      if (this.svgCanvas) {
        this.svgCanvas.classList.toggle('hidden', enabled || this.is3DMode);
        this.svgCanvas.classList.remove('map-transition-in', 'map-transition-out');
      }
      if (enabled) {
        this.resetZoom();
        this.renderCampusDistancePanel();
      } else {
        this.renderFloor(this.currentFloorNum);
        this.resetZoom();
      }
    }
  }

  /**
   * 検索結果クリックやダイレクトリンクからの遷移時に、平面図をズームインさせず
   * フロア全体が見える状態（初期表示と同じパン・ズーム）に戻す。
   * 該当の部屋自体は selectedRoomIds / searchPinRoomId によるハイライト表示
   * （赤枠・📍など）で示されるため、ズームインして中央寄せしなくても
   * どの部屋かは十分に分かる。
   */
  centerOnRoom(room) {
    if (!room) return;
    this.resetZoom();
  }

  getSVGPoint(clientX, clientY) {
    const pt = this.svgCanvas.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = this.svgWorld.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
  }

  toggleAddRoomMode() {
    if (!this.isEditMode) return;
    if (this.is3DMode) {
      alert('立体表示中は編集できません。先にフロアをクリックして編集画面に戻ってください。');
      return;
    }
    if (this.isAddRoomMode) {
      this.exitAddRoomMode();
    } else {
      this.enterAddRoomMode();
    }
  }

  enterAddRoomMode() {
    this.isAddRoomMode = true;
    this.btnAddRoom.classList.add('active');
    this.addModeBanner.classList.remove('hidden');
    this.viewport.classList.add('add-mode');
  }

  exitAddRoomMode() {
    this.isAddRoomMode = false;
    this.isDrawingRoom = false;
    this.drawStartPt = null;
    this.layerPreview.innerHTML = '';
    this.btnAddRoom.classList.remove('active');
    this.addModeBanner.classList.add('hidden');
    this.viewport.classList.remove('add-mode');
  }

  createRoomWithBounds(x, y, w, h) {
    const floorObj = this.data.floors.find(f => f.floor === this.currentFloorNum);
    if (!floorObj) return;

    const newNo = `${this.currentFloorNum}${floorObj.rooms.length + 1}`;
    const newName = "新規描画区画";

    const newRoom = {
      room_id: `${this.currentFloorNum}F_NEW_${Date.now()}`,
      room_number: newNo,
      room_name: newName,
      display_number: newNo,
      display_label: newName,
      category: "classroom",
      affiliation: "other",
      teachers: [],
      center_point_mm: [x + w / 2.0, y + h / 2.0],
      bounding_box_mm: { x: x, y: y, width: w, height: h },
      polygon_mm: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h]
      ]
    };

    floorObj.rooms.push(newRoom);

    this.selectedRoomIds.clear();
    this.selectedRoomIds.add(newRoom.room_id);

    this.renderFloor(this.currentFloorNum);
    this.savePersistedData();
    this.exitAddRoomMode();
  }

  toggleRouteVisibility() {
    this.isRouteVisible = !this.isRouteVisible;
    if (this.btnToggleRoute) {
      this.btnToggleRoute.classList.toggle('active', this.isRouteVisible);
      this.btnToggleRoute.textContent = this.isRouteVisible ? '🧭 経路表示' : '🧭 経路非表示';
    }
    if (!this.isRouteVisible && this.layerRoutePath) {
      this.layerRoutePath.innerHTML = '';
      if (this.renderer3D) this.renderer3D.setRoute(null);
    } else {
      this.updateRoutePath();
    }
  }

  zoom(factor) {
    if (this.is3DMode) {
      if (this.renderer3D) {
        this.renderer3D.zoomBy(factor);
        this.update3DZoomIndicator();
      }
      return;
    }
    if (this.isCampusMode) {
      this.campusZoom(factor);
      return;
    }
    this.scale *= factor;
    this.scale = Math.min(Math.max(0.2, this.scale), 5.0);
    this.updateTransform();
  }

  update3DZoomIndicator() {
    if (this.zoomIndicator && this.renderer3D) {
      const pct = Math.round((this.renderer3D.scale / 0.008) * 100);
      this.zoomIndicator.textContent = `${pct}%`;
    }
  }

  campusZoom(factor) {
    this.campusScale *= factor;
    this.campusScale = Math.min(Math.max(0.2, this.campusScale), 5.0);
    this.updateTransform();
  }

  /**
   * SVGの viewBox は preserveAspectRatio="xMidYMid meet" によって、コンテナに
   * 収まるよう「幅・高さのどちらか制約が厳しい方」の軸を自動的に基準にして
   * 縮小表示される（＝比率を保ったまま全体が見えるcontain的な挙動）。
   * ここではその上に掛かる内側の <g> の scale/translate を調整し、
   * 「常に指定した軸（幅 or 高さ）を基準にフィットさせる」デフォルト表示を作る。
   * fitAxis で指定した軸がすでに制約側であれば追加ズームは不要（倍率1倍のまま）、
   * そうでなければ、その軸がぴったり画面いっぱいになるまで拡大する
   * （＝もう一方の軸は画面からはみ出し、ドラッグ／ピンチで見る想定）。
   */
  computeAxisFitScale(containerEl, viewBoxW, viewBoxH, fitAxis) {
    if (!containerEl) return 1;
    const rect = containerEl.getBoundingClientRect();
    const containerW = rect.width || 1;
    const containerH = rect.height || 1;
    const autoFitScale = Math.min(containerW / viewBoxW, containerH / viewBoxH);
    const desiredScale = fitAxis === 'height' ? (containerH / viewBoxH) : (containerW / viewBoxW);
    if (!autoFitScale) return 1;
    return Math.max(1, desiredScale / autoFitScale);
  }

  resetZoom() {
    if (this.is3DMode) {
      if (this.renderer3D) {
        this.renderer3D.resetView();
        this.update3DZoomIndicator();
      }
      return;
    }
    if (this.isCampusMode) {
      // キャンパス付近地図：画面の「縦幅」を基準にピッタリフィット拡大させる
      const rect = this.svgCampus ? this.svgCampus.getBoundingClientRect() : null;
      const containerW = (rect && rect.width > 0) ? rect.width : window.innerWidth;
      const containerH = (rect && rect.height > 0) ? rect.height : window.innerHeight;

      const vbW = 3955;
      const vbH = 2523;
      const baseContainScale = Math.min(containerW / vbW, containerH / vbH);
      const heightFitScale = containerH / vbH;
      const fitScale = (baseContainScale > 0) ? (heightFitScale / baseContainScale) : 1.0;

      const viewCenterX = vbW / 2;
      const viewCenterY = vbH / 2;

      this.campusScale = Math.max(1.0, fitScale);
      this.campusPanX = viewCenterX * (1 - this.campusScale);
      this.campusPanY = viewCenterY * (1 - this.campusScale);
      this.updateTransform();
      return;
    }
    // B3棟平面図：全体像が必ず収まるよう画面の横幅をフィット基準にデフォルト表示
    // viewBox="0 0 48400 54000" と preserveAspectRatio="xMidYMid meet" により、
    // 画面の横幅に合わせて全体像（全階層）が切り取られることなく画面内にピッタリ表示されます。
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  /** 2本指タッチ間の距離（ピンチズームの基準値算出用） */
  touchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  updateTransform() {
    if (this.isCampusMode) {
      const campusWorld = document.getElementById('svg-campus-world');
      if (campusWorld) {
        campusWorld.setAttribute('transform', `translate(${this.campusPanX}, ${this.campusPanY}) scale(${this.campusScale})`);
      }
      this.zoomIndicator.textContent = `${Math.round(this.campusScale * 100)}%`;
      return;
    }
    this.svgWorld.setAttribute('transform', `translate(${this.panX}, ${this.panY}) scale(${this.scale})`);
    this.zoomIndicator.textContent = `${Math.round(this.scale * 100)}%`;
  }

  renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    container.innerHTML = '';

    Object.keys(CATEGORY_COLORS).forEach(cat => {
      const info = CATEGORY_COLORS[cat];
      const item = document.createElement('label');
      item.className = 'category-item';

      item.innerHTML = `
        <div class="category-label-group">
          <span class="color-badge" style="background: ${info.stroke};"></span>
          <span>${info.name}</span>
        </div>
        <input type="checkbox" data-cat="${cat}" checked>
      `;

      item.querySelector('input').addEventListener('change', (e) => {
        this.categoryState[cat] = e.target.checked;
        this.renderRoomsOnly();
        this.renderLabelsOnly();
      });

      container.appendChild(item);
    });
  }

  renderAffiliationFilters() {
    const container = document.getElementById('affiliation-filters');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(AFFILIATION_COLORS).forEach(aff => {
      const info = AFFILIATION_COLORS[aff];
      const item = document.createElement('label');
      item.className = 'category-item';

      // 2色（緑／白）の項目は縞模様、黒枠の項目は白フチ付きのバッジで見分けられるようにする
      let badgeStyle = `background: ${info.color};`;
      if (info.color2) {
        badgeStyle = `background: repeating-linear-gradient(45deg, ${info.color} 0 4px, ${info.color2} 4px 8px); border: 1px solid rgba(255,255,255,0.4);`;
      } else if (info.halo) {
        badgeStyle += ' border: 1px solid rgba(255,255,255,0.7);';
      }

      item.innerHTML = `
        <div class="category-label-group">
          <span class="color-badge" style="${badgeStyle}"></span>
          <span>${info.name}</span>
        </div>
        <input type="checkbox" data-aff="${aff}" checked>
      `;

      item.querySelector('input').addEventListener('change', (e) => {
        this.affiliationState[aff] = e.target.checked;
        this.renderRoomsOnly();
      });

      container.appendChild(item);
    });
  }

  /**
   * 画面ビュー（B3平面図, キャンパス地図, 3D立体表示）の表示切替をスムーズなアニメーションで行う。
   */
  animateViewTransition(entering, leaving, onFinish) {
    if (!entering || !leaving || entering === leaving) {
      if (onFinish) onFinish();
      return;
    }

    if (this._mapTransitionTimer) {
      clearTimeout(this._mapTransitionTimer);
      this._mapTransitionTimer = null;
    }

    entering.classList.remove('hidden');
    entering.classList.add('map-transition-out');
    entering.classList.remove('map-transition-in');

    leaving.classList.remove('hidden');
    leaving.classList.add('map-transition-in');
    leaving.classList.remove('map-transition-out');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        entering.classList.remove('map-transition-out');
        entering.classList.add('map-transition-in');
        leaving.classList.remove('map-transition-in');
        leaving.classList.add('map-transition-out');
      });
    });

    this._mapTransitionTimer = setTimeout(() => {
      leaving.classList.add('hidden');
      leaving.classList.remove('map-transition-out', 'map-transition-in');
      entering.classList.remove('map-transition-out', 'map-transition-in');
      this._mapTransitionTimer = null;
      if (onFinish) onFinish();
    }, 360);
  }

  toggle3DView() {
    if (this.is3DMode) {
      this.exit3DView();
    } else {
      this.enter3DView();
    }
  }

  enter3DView() {
    this.exitAddRoomMode();
    this.selectedRoomIds.clear();
    this.is3DMode = true;
    this.btn3DView.classList.add('active');
    this.viewport.classList.add('mode-3d');

    const leaving = this.isCampusMode ? this.svgCampus : this.svgCanvas;
    this.animateViewTransition(this.canvas3D, leaving);

    if (!this.renderer3D) {
      this.renderer3D = new Stacked3DRenderer(this.canvas3D, {
        totalWidth: STACK_VIEW_TOTAL_WIDTH,
        totalHeight: STACK_VIEW_TOTAL_HEIGHT,
        // 立体表示中にフロア板をクリックすると、そのフロアの通常編集画面に戻る
        onFloorClick: (floorNum) => {
          this.exit3DView();
          this.switchToFloor(floorNum);
        }
      });
    } else {
      // 表示領域が変わった直後の可能性があるのでサイズを合わせ直す
      this.renderer3D.resize();
      // 前回の検索ハイライトが残らないようにクリアしておく（この後、必要なら再設定する）
      this.renderer3D.clearHighlight();
    }

    this.render3DStackedView();
    if (this.renderer3D) {
      this.renderer3D.setRoute(this.isRouteVisible ? this.lastRoute : null);
    }

    // 検索結果／ダイレクトリンクから遷移してきた部屋がある状態で3D表示に切り替えた場合、
    // 従来はハイライト状態が2D側にしか残らず、3D表示ではフロア建物外形（白）・部屋（赤塗り）
    // ともに表示されていなかった。ここで現在の検索対象部屋を3D側にも引き継いで表示する。
    if (this.searchPinRoomId) {
      this.renderer3D.highlightRoom(this.currentFloorNum, this.searchPinRoomId);
    }

    this.updateGpsButtonVisibility();
    this.renderEditorCard();
  }

  exit3DView() {
    this.is3DMode = false;
    this.btn3DView.classList.remove('active');
    this.viewport.classList.remove('mode-3d');

    const entering = this.isCampusMode ? this.svgCampus : this.svgCanvas;
    this.animateViewTransition(entering, this.canvas3D);

    // 3D表示を離れる間は非表示のCanvasを裏で再描画し続ける必要が無いため、
    // 点滅アニメーションループを止めておく（次回enter3DView時に必要なら再開する）。
    if (this.renderer3D) {
      this.renderer3D.stopHighlightBlink();
    }
    if (!this.isCampusMode) {
      this.renderFloor(this.currentFloorNum);
    }
    this.resetZoom();
  }

  /**
   * 指定フロアの出入口ラベル（現状は1Fの「東正面入口」「西入口」）を計算する。
   * 座標は建物外形のバウンディングボックスから動的に求めるため、平面図データが
   * 変わっても追従する。2D平面図・3D立体表示の両方で共通して使う。
   * @param {Object} floorObj
   * @returns {Array<{position_mm:number[], label:string, side:'south'|'north'}>|null}
   */
  getEntrancesForFloor(floorObj) {
    if (!floorObj || floorObj.floor !== 1) return null;
    const outline = floorObj.building_outline;
    if (!outline || outline.length === 0) return null;

    const xs = outline.map(p => p[0]);
    const ys = outline.map(p => p[1]);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return [
      // 平面図（SVG, y下向き）で画面下方中央 = building_outlineのY最大側
      { position_mm: [centerX, maxY], label: '東正面入口', side: 'south' },
      // 平面図で画面上方中央 = building_outlineのY最小側
      { position_mm: [centerX, minY], label: '西入口', side: 'north' }
    ];
  }

  // 全フロアをアイソメトリック投影で積み上げ表示する（実際の部屋ポリゴン・建物外形をそのまま使用）。
  // レイヤー表示制御・カテゴリ/所属フィルタは2D編集画面と同じ状態を反映する。
  render3DStackedView() {
    if (!this.renderer3D) return;

    const floorsForRenderer = this.data.floors.map(floorObj => {
      const rooms = floorObj.rooms
        .filter(room => room.visible !== false)
        .filter(room => this.categoryState[room.category])
        .filter(room => this.affiliationState[room.affiliation || 'other'])
        .map(room => {
          const catInfo = CATEGORY_COLORS[room.category] || { fill: 'rgba(148, 163, 184, 0.25)' };
          const affInfo = AFFILIATION_COLORS[room.affiliation || 'other'] || AFFILIATION_COLORS.other;

          return {
            room_id: room.room_id,
            polygon_mm: room.polygon_mm,
            category: room.category,
            fillColor: this.layerState.fillColors ? catInfo.fill : 'rgba(148, 163, 184, 0.15)',
            strokeColor: affInfo.color,
            // 2D編集画面と同じ所属枠色ルール（緑/白の縞模様・黒枠の白ハロー）を3D表示にも反映する
            strokeColor2: affInfo.color2 || null,
            strokeHalo: !!affInfo.halo,
            center_point_mm: room.center_point_mm,
            // 3D表示では文字ラベルは出さず、階段・トイレ・EVのアイコンのみを表示する
            icon: this.getRoomIconMeta(room)
          };
        });

      return {
        floor: floorObj.floor,
        building_outline: floorObj.building_outline,
        rooms,
        entrances: this.getEntrancesForFloor(floorObj)
      };
    });

    this.renderer3D.setData(floorsForRenderer, CATEGORY_COLORS, {
      width: STACK_VIEW_TOTAL_WIDTH,
      height: STACK_VIEW_TOTAL_HEIGHT
    });
  }

  renderFloor(floorNum) {
    const floorObj = this.data.floors.find(f => f.floor === floorNum);
    if (!floorObj) return;

    this.layerBuilding.innerHTML = '';
    this.layerCadWalls.innerHTML = '';

    const bPolyPoints = floorObj.building_outline.map(p => p.join(',')).join(' ');
    const bPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    bPoly.setAttribute('points', bPolyPoints);
    bPoly.setAttribute('fill', 'none');
    bPoly.setAttribute('stroke', '#38bdf8');
    bPoly.setAttribute('stroke-width', '200');
    this.layerBuilding.appendChild(bPoly);

    if (floorObj.walls && this.layerState.cadWalls) {
      const pathData = floorObj.walls.map(w => 
        `M ${w.x} ${w.y} h ${w.w} v ${w.h} h ${-w.w} Z`
      ).join(' ');
      const wallPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      wallPath.setAttribute('d', pathData);
      wallPath.setAttribute('fill', 'rgba(148, 163, 184, 0.4)');
      wallPath.setAttribute('stroke', '#64748b');
      wallPath.setAttribute('stroke-width', '100');
      this.layerCadWalls.appendChild(wallPath);
    }

    this.updateGpsButtonVisibility();
    this.renderRoomsOnly();
    this.renderLabelsOnly();
    this.renderHighlight();
    this.renderEditorCard();
  }

  /** GPS現在地表示ボタンの可視性を制御。キャンパス付近地図モード中のみ表示し、平面図・3D表示時は非表示にする。 */
  updateGpsButtonVisibility() {
    if (!this.btnGpsLocate) return;
    const show = this.isCampusMode && !this.is3DMode;
    this.btnGpsLocate.style.display = show ? '' : 'none';
  }

  renderRoomsOnly() {
    if (this.is3DMode) {
      this.render3DStackedView();
      return;
    }
    this.layerRooms.innerHTML = '';
    const floorObj = this.data.floors.find(f => f.floor === this.currentFloorNum);
    if (!floorObj) return;

    floorObj.rooms.forEach(room => {
      if (room.visible === false) return;
      if (!this.categoryState[room.category]) return;

      const affKey = room.affiliation || 'other';
      const affInfo = AFFILIATION_COLORS[affKey] || AFFILIATION_COLORS.other;
      if (!this.affiliationState[affKey]) return;

      const catInfo = CATEGORY_COLORS[room.category] || { fill: 'rgba(148, 163, 184, 0.2)', stroke: '#94a3b8' };
      const pts = room.polygon_mm.map(p => p.join(',')).join(' ');
      const showOutline = this.layerState.roomOutlines;

      // 黒枠（主事室・管理職）はダークテーマ背景に埋もれないよう、外側に白いハローを先に描画する
      if (showOutline && affInfo.halo) {
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        halo.setAttribute('points', pts);
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', '#ffffff');
        halo.setAttribute('stroke-width', '500');
        halo.style.pointerEvents = 'none';
        this.layerRooms.appendChild(halo);
      }

      // 部屋本体（クリック判定・塗りつぶし・所属に応じた枠色）
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', pts);
      poly.setAttribute('class', `room-poly ${this.selectedRoomIds.has(room.room_id) ? 'selected' : ''}`);
      poly.setAttribute('fill', this.layerState.fillColors ? catInfo.fill : 'transparent');
      poly.setAttribute('stroke', showOutline ? affInfo.color : 'none');
      poly.setAttribute('stroke-width', '200');
      poly.setAttribute('data-id', room.room_id);

      poly.addEventListener('click', (e) => {
        if (this.isAddRoomMode) return;
        e.stopPropagation();
        // Ctrl/Cmd+ドラッグでこの部屋の上からパンした直後のクリックは、
        // 選択状態を変えないよう1回だけ無視する。
        if (this.suppressNextRoomClick) {
          this.suppressNextRoomClick = false;
          return;
        }
        // Shift+クリックでの複数選択（結合用）は編集モードの時だけ有効にする
        this.toggleRoomSelection(room.room_id, this.isEditMode && e.shiftKey);
      });

      this.layerRooms.appendChild(poly);

      // 2色（緑／白）の所属は、上に破線を重ねて縞模様の枠線にする
      if (showOutline && affInfo.color2) {
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        overlay.setAttribute('points', pts);
        overlay.setAttribute('fill', 'none');
        overlay.setAttribute('stroke', affInfo.color2);
        overlay.setAttribute('stroke-width', '200');
        overlay.setAttribute('stroke-dasharray', '500,500');
        overlay.style.pointerEvents = 'none';
        this.layerRooms.appendChild(overlay);
      }
    });
  }

  // 部屋名（display_label / room_name）から該当する設備アイコンを判定する。
  // 「多目的トイレ」は「トイレ」も含むため判定順序に注意し、
  // 「男子/多目的トイレ」「女子/多目的トイレ」のように性別＋多目的が両方含まれる場合は
  // 男女マークと多目的マークを併記する。
  getRoomIconMeta(room) {
    const name = `${room.display_label || ''} ${room.room_name || ''}`;
    const hasMultipurpose = name.includes('多目的');
    const hasToilet = name.includes('トイレ');
    const hasFemale = name.includes('女');
    const hasMale = name.includes('男');

    if (hasMultipurpose && hasToilet && hasFemale) {
      return { kind: 'emoji-group', glyphs: ['🚺', '♿'], title: '女子/多目的トイレ' };
    }
    if (hasMultipurpose && hasToilet && hasMale) {
      return { kind: 'emoji-group', glyphs: ['🚹', '♿'], title: '男子/多目的トイレ' };
    }
    if (hasMultipurpose && hasToilet) {
      return { kind: 'emoji', glyph: '♿', title: '多目的トイレ' };
    }
    if (hasToilet && hasFemale) {
      return { kind: 'emoji', glyph: '🚺', title: '女子トイレ' };
    }
    if (hasToilet && hasMale) {
      return { kind: 'emoji', glyph: '🚹', title: '男子トイレ' };
    }
    if (name.includes('エレベータ') || name.includes('エレベーター') || /\bEV\b/i.test(name)) {
      return { kind: 'emoji', glyph: '🛗', title: 'エレベーター' };
    }
    if (name.includes('階段')) {
      return { kind: 'stairs', title: '階段' };
    }
    return null;
  }

  // アイコンのSVGマークアップを生成する（絵文字が使えない環境でも崩れないよう、
  // 階段のみ自前のSVGピクトグラムを描画する）
  buildRoomIconMarkup(cx, cy, meta) {
    if (!meta) return '';
    const iconY = cy;
    const size = 1700;

    if (meta.kind === 'emoji') {
      return `<text class="room-label-icon" x="${cx}" y="${iconY}" font-size="${size}" text-anchor="middle" dominant-baseline="middle"><title>${meta.title}</title>${meta.glyph}</text>`;
    }
    if (meta.kind === 'emoji-group') {
      // 複数マーク（例: 男女マーク＋多目的マーク）を横に並べて併記する
      const groupSize = size * 0.85;
      const spacing = groupSize * 1.05;
      const totalWidth = spacing * (meta.glyphs.length - 1);
      const startX = cx - totalWidth / 2;
      return meta.glyphs.map((glyph, i) => {
        const x = startX + i * spacing;
        return `<text class="room-label-icon" x="${x}" y="${iconY}" font-size="${groupSize}" text-anchor="middle" dominant-baseline="middle"><title>${meta.title}</title>${glyph}</text>`;
      }).join('');
    }
    if (meta.kind === 'stairs') {
      return `
        <svg class="room-label-icon" x="${cx - size / 2}" y="${iconY - size / 2}" width="${size}" height="${size}" viewBox="0 0 100 100">
          <title>${meta.title}</title>
          <polygon points="0,100 0,75 25,75 25,50 50,50 50,25 75,25 75,0 100,0 100,100" fill="#f8fafc" opacity="0.92" />
        </svg>
      `;
    }
    return '';
  }

  // ------- 部屋番号・部屋名の折り返し／省略表示 -------
  // Canvasの2Dコンテキストで実際のフォントメトリクスを計測し、部屋の横幅に
  // 収まるよう複数行に折り返す。指定行数を超えてもなお収まらない場合は
  // 最終行の末尾を "..." で省略する。
  getMeasureCtx() {
    if (!this._measureCtx) {
      const canvas = document.createElement('canvas');
      this._measureCtx = canvas.getContext('2d');
    }
    return this._measureCtx;
  }

  /**
   * text を maxWidthUnits に収まる行の配列に分割する。
   * maxLines を超える分は末尾の行を "..." で省略する。
   */
  wrapLabelText(text, fontSizeUnits, fontWeight, fontFamily, maxWidthUnits, maxLines) {
    if (!text) return [];
    const ctx = this.getMeasureCtx();
    ctx.font = `${fontWeight} ${fontSizeUnits}px ${fontFamily}`;

    if (ctx.measureText(text).width <= maxWidthUnits) return [text];

    const lines = [];
    let remaining = text;
    while (remaining.length > 0 && lines.length < maxLines) {
      // 二分探索で、この行に入る最大文字数を求める（日本語には単語区切りのスペースが
      // 無いため、単語単位ではなく文字単位で折り返す）
      let lo = 1, hi = remaining.length, fit = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const w = ctx.measureText(remaining.slice(0, mid)).width;
        if (w <= maxWidthUnits) { fit = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      lines.push(remaining.slice(0, fit));
      remaining = remaining.slice(fit);
    }

    if (remaining.length > 0) {
      // maxLines行に収まりきらない分が残っている → 最終行を "..." 付きに省略
      let last = lines[lines.length - 1] || '';
      while (last.length > 0 && ctx.measureText(last + '...').width > maxWidthUnits) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${last}...`;
    }
    return lines;
  }

  isMobileViewport() {
    return this.forceMobileUI || window.matchMedia('(max-width: 1200px)').matches;
  }

  /** 現在のモバイルUI判定結果および画面サイズ分類（高さ・幅）を <body> のクラス（.ui-mobile, .ui-compact-height, etc.）に反映する。 */
  updateMobileUIClass() {
    const isMobile = this.isMobileViewport();
    document.body.classList.toggle('ui-mobile', isMobile);
    document.body.classList.toggle('ui-mobile-forced', this.forceMobileUI);

    if (isMobile) {
      const h = window.innerHeight;
      const w = window.innerWidth;

      // 画面高さ基準の最適化用クラス
      document.body.classList.toggle('ui-compact-height', h <= 750);
      document.body.classList.toggle('ui-ultra-compact-height', h <= 620);

      // 画面幅基準の最適化用クラス
      document.body.classList.toggle('ui-compact-width', w <= 400);
      document.body.classList.toggle('ui-ultra-compact-width', w <= 350);

      // モバイルブラウザのアドレスバー考慮用 --vh
      const vh = h * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    } else {
      document.body.classList.remove(
        'ui-compact-height',
        'ui-ultra-compact-height',
        'ui-compact-width',
        'ui-ultra-compact-width'
      );
    }
  }

  // 部屋番号・部屋名・担当教員・設備アイコンをまとめたラベルのinnerHTMLを生成する共通処理
  buildRoomLabelHtml(room) {
    const [cx, cy] = room.center_point_mm;
    const numText = room.display_number || room.room_number;
    const nameText = room.display_label || room.room_name;
    const teacherText = (room.teachers || []).join('、');

    // トイレ・階段・エレベーター(EV) は、部屋番号や名称テキストを出さず
    // アイコンのみを表示する（平面図が煩雑にならないようにするため）
    const iconMeta = this.getRoomIconMeta(room);
    if (iconMeta) {
      return this.buildRoomIconMarkup(cx, cy, iconMeta);
    }

    let html = '';

    const mobile = this.isMobileViewport();

    // PC幅：従来どおりの1行固定表示（挙動を変えない）
    if (!mobile) {
      if (this.layerState.roomNumbers && numText) {
        html += `<text class="room-label-num" x="${cx}" y="${cy - 300}" font-size="800" fill="#f8fafc" text-anchor="middle" dominant-baseline="middle">${numText}</text>`;
      }
      if (this.layerState.roomNames && nameText) {
        const yOff = this.layerState.roomNumbers ? 600 : 0;
        html += `<text class="room-label-name" x="${cx}" y="${cy + yOff}" font-size="600" fill="#cbd5e1" text-anchor="middle" dominant-baseline="middle">${nameText}</text>`;
      }
      if (this.layerState.roomTeachers && teacherText) {
        let teacherYOff = 0;
        if (this.layerState.roomNumbers) teacherYOff += 600;
        if (this.layerState.roomNames) teacherYOff += 550;
        html += `<text class="room-label-teacher" x="${cx}" y="${cy + teacherYOff}" font-size="480" fill="#7dd3fc" text-anchor="middle" dominant-baseline="middle">👤 ${teacherText}</text>`;
      }
      return html;
    }

    // モバイル幅：文字を大きく表示。部屋枠(横幅)に収まらない場合は自動折り返し、
    // 指定行数を超える場合は末尾を "..." で省略する。
    const numFontSize = 1200;
    const nameFontSize = 900;
    const teacherFontSize = 480;

    const boxWidth = (room.bounding_box_mm && room.bounding_box_mm.width) ? room.bounding_box_mm.width : 6000;
    const maxTextWidth = boxWidth * 0.9;
    const numMaxLines = 2;
    const nameMaxLines = 3;

    const showNum = this.layerState.roomNumbers && numText;
    const showName = this.layerState.roomNames && nameText;
    const showTeacher = this.layerState.roomTeachers && teacherText;

    const numLines = showNum
      ? this.wrapLabelText(numText, numFontSize, 800, "'Inter', sans-serif", maxTextWidth, numMaxLines)
      : [];
    const nameLines = showName
      ? this.wrapLabelText(nameText, nameFontSize, 600, "'Noto Sans JP', sans-serif", maxTextWidth, nameMaxLines)
      : [];

    const numLineHeight = numFontSize * 1.05;
    const nameLineHeight = nameFontSize * 1.15;
    const teacherLineHeight = teacherFontSize * 1.15;

    const numBlockHeight = numLines.length * numLineHeight;
    const nameBlockHeight = nameLines.length * nameLineHeight;
    const teacherBlockHeight = showTeacher ? teacherLineHeight : 0;

    const gapNumName = (numLines.length && nameLines.length) ? nameFontSize * 0.25 : 0;
    const gapNameTeacher = (showTeacher && (numLines.length || nameLines.length)) ? teacherFontSize * 0.35 : 0;

    // 部屋番号→部屋名→担当教員 の順で縦に積み、全体を部屋の中心(cy)に対して上下中央に揃える
    const totalHeight = numBlockHeight + gapNumName + nameBlockHeight + gapNameTeacher + teacherBlockHeight;
    let cursorY = cy - totalHeight / 2;

    if (numLines.length) {
      html += `<text class="room-label-num" font-size="${numFontSize}" fill="#f8fafc" text-anchor="middle" dominant-baseline="middle">`;
      numLines.forEach((line, i) => {
        const lineCenterY = cursorY + numLineHeight * (i + 0.5);
        html += `<tspan x="${cx}" y="${lineCenterY}">${line}</tspan>`;
      });
      html += `</text>`;
      cursorY += numBlockHeight + gapNumName;
    }

    if (nameLines.length) {
      html += `<text class="room-label-name" font-size="${nameFontSize}" fill="#cbd5e1" text-anchor="middle" dominant-baseline="middle">`;
      nameLines.forEach((line, i) => {
        const lineCenterY = cursorY + nameLineHeight * (i + 0.5);
        html += `<tspan x="${cx}" y="${lineCenterY}">${line}</tspan>`;
      });
      html += `</text>`;
      cursorY += nameBlockHeight + gapNameTeacher;
    }

    if (showTeacher) {
      const teacherCenterY = cursorY + teacherLineHeight / 2;
      html += `<text class="room-label-teacher" x="${cx}" y="${teacherCenterY}" font-size="${teacherFontSize}" fill="#7dd3fc" text-anchor="middle" dominant-baseline="middle">👤 ${teacherText}</text>`;
    }

    return html;
  }

  renderLabelsOnly() {
    this.layerLabels.innerHTML = '';
    const floorObj = this.data.floors.find(f => f.floor === this.currentFloorNum);
    if (!floorObj) return;

    floorObj.rooms.forEach(room => {
      if (room.visible === false) return;
      if (!this.categoryState[room.category]) return;
      const affKey = room.affiliation || 'other';
      if (!this.affiliationState[affKey]) return;

      if (room.show_text !== false) {
        const gLabel = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gLabel.setAttribute('data-label-id', room.room_id);
        gLabel.innerHTML = this.buildRoomLabelHtml(room);
        this.layerLabels.appendChild(gLabel);
      }
    });

    this.renderExteriorDirectionLabels(floorObj);
  }

  /** 1Fの外部方向ラベル（生協側・南）を平面図上に描画する。 */
  renderExteriorDirectionLabels(floorObj) {
    if (!floorObj || floorObj.floor !== 1) return;

    const outline = floorObj.building_outline;
    if (!outline || outline.length === 0) return;

    const xs = outline.map(p => p[0]);
    const ys = outline.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const labels = [
      { position_mm: [centerX, maxY + 3500], label: '東正面入口' },
      { position_mm: [centerX, minY - 3500], label: '西入口（生協側）' },
      { position_mm: [minX - 3500, centerY], label: '南' },
      { position_mm: [maxX + 3500, centerY], label: '北' }
    ];

    const svgNS = 'http://www.w3.org/2000/svg';

    labels.forEach(ent => {
      const [lx, ly] = ent.position_mm;
      const boxW = ent.label.length * 780 + 400;
      const boxH = 900;

      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'entrance-label');

      const bg = document.createElementNS(svgNS, 'rect');
      bg.setAttribute('x', lx - boxW / 2);
      bg.setAttribute('y', ly - boxH / 2);
      bg.setAttribute('width', boxW);
      bg.setAttribute('height', boxH);
      bg.setAttribute('rx', '150');
      bg.setAttribute('fill', 'rgba(15, 23, 42, 0.88)');
      bg.setAttribute('stroke', 'rgba(34, 197, 94, 0.9)');
      bg.setAttribute('stroke-width', '60');
      g.appendChild(bg);

      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', lx);
      text.setAttribute('y', ly);
      text.setAttribute('font-size', '640');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('fill', '#4ade80');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = ent.label;
      g.appendChild(text);

      this.layerLabels.appendChild(g);
    });
  }

  updateSingleRoomLabelFast(room) {
    const gLabel = this.layerLabels.querySelector(`g[data-label-id="${room.room_id}"]`);
    if (!gLabel) {
      this.renderLabelsOnly();
      this.savePersistedData();
      return;
    }

    gLabel.innerHTML = this.buildRoomLabelHtml(room);
    this.savePersistedData();
  }

  updateRoomShapeFromDimensions(room, x, y, w, h) {
    room.bounding_box_mm = { x: x, y: y, width: w, height: h };
    room.center_point_mm = [x + w / 2.0, y + h / 2.0];
    room.polygon_mm = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h]
    ];

    this.renderRoomsOnly();
    this.renderLabelsOnly();
    this.renderHighlight();
    this.savePersistedData();
  }

  toggleRoomSelection(roomId, isShiftKey) {
    this.searchPinRoomId = null;
    this.isRoomSelectedByDirectClick = true;
    if (!isShiftKey) {
      this.selectedRoomIds.clear();
    }
    if (this.selectedRoomIds.has(roomId)) {
      this.selectedRoomIds.delete(roomId);
    } else {
      this.selectedRoomIds.add(roomId);
    }

    this.renderHighlight();
    this.renderEditorCard();
  }

  renderHighlight() {
    this.layerHighlight.innerHTML = '';
    const floorObj = this.data.floors.find(f => f.floor === this.currentFloorNum);
    if (!floorObj) return;

    this.selectedRoomIds.forEach(id => {
      const room = floorObj.rooms.find(r => r.room_id === id);
      if (room) {
        const pts = room.polygon_mm.map(p => p.join(',')).join(' ');
        const hPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        hPoly.setAttribute('points', pts);

        // 検索結果／ダイレクトリンクから遷移してきた部屋は、編集モードでの通常選択（水色の淡い枠）
        // とは区別し、枠内をしっかり赤く塗って一目で分かるようにする（3D表示の赤ハイライトと統一）
        const isSearchTarget = id === this.searchPinRoomId;
        if (isSearchTarget) {
          hPoly.setAttribute('fill', 'rgba(239, 68, 68, 0.55)');
          hPoly.setAttribute('stroke', '#ef4444');
          hPoly.setAttribute('stroke-width', '500');
          // 検索結果／ダイレクトリンク経由のハイライトは点滅させて視認性を上げる
          // （CSS側の @keyframes room-highlight-blink を参照）
          hPoly.setAttribute('class', 'search-highlight-blink');
        } else {
          hPoly.setAttribute('fill', 'rgba(56, 189, 248, 0.35)');
          hPoly.setAttribute('stroke', '#ffffff');
          hPoly.setAttribute('stroke-width', '400');
        }
        this.layerHighlight.appendChild(hPoly);

        // 検索結果から遷移してきた部屋には📍を落として位置を分かりやすくする
        if (isSearchTarget && room.center_point_mm) {
          this.renderSearchPin(room.center_point_mm);
        }
      }
    });

    this.updateRoutePath();
  }

  renderSearchPin(centerPointMm) {
    const [cx, cy] = centerPointMm;
    const svgNS = 'http://www.w3.org/2000/svg';

    const group = document.createElementNS(svgNS, 'g');
    group.setAttribute('class', 'search-pin-group');

    // 1. 接地影 (Ground Shadow)
    const shadow = document.createElementNS(svgNS, 'ellipse');
    shadow.setAttribute('cx', cx);
    shadow.setAttribute('cy', cy);
    shadow.setAttribute('rx', '850');
    shadow.setAttribute('ry', '350');
    shadow.setAttribute('fill', 'rgba(15, 23, 42, 0.45)');
    group.appendChild(shadow);

    // 2. ピンの針 (Stem Needle)
    const needle = document.createElementNS(svgNS, 'line');
    needle.setAttribute('x1', cx);
    needle.setAttribute('y1', cy);
    needle.setAttribute('x2', cx);
    needle.setAttribute('y2', cy - 3200);
    needle.setAttribute('stroke', '#e2e8f0');
    needle.setAttribute('stroke-width', '240');
    needle.setAttribute('stroke-linecap', 'round');
    group.appendChild(needle);

    // 3. ピンの赤色頭部 (Red Ball Head)
    const head = document.createElementNS(svgNS, 'circle');
    head.setAttribute('cx', cx);
    head.setAttribute('cy', cy - 3600);
    head.setAttribute('r', '1400');
    head.setAttribute('fill', '#ef4444');
    head.setAttribute('stroke', '#b91c1c');
    head.setAttribute('stroke-width', '160');
    group.appendChild(head);

    // 4. ピン頭部のツヤハイライト (Gloss Highlight)
    const highlight = document.createElementNS(svgNS, 'circle');
    highlight.setAttribute('cx', cx - 450);
    highlight.setAttribute('cy', cy - 4050);
    highlight.setAttribute('r', '450');
    highlight.setAttribute('fill', 'rgba(255, 255, 255, 0.85)');
    group.appendChild(highlight);

    this.layerHighlight.appendChild(group);
  }

  // ========================================================================
  // GPS現在地表示機能
  // ========================================================================

  /**
   * 1F平面図に既に登録されている出入口（東正面入口・西入口）の座標を基準点として、
   * GPS→平面図mm座標の変換を自動的に計算する。building_outlineの変更（JSON再読込・
   * リセット等）にも追従できるよう、GPS追跡を開始するたびに呼び直す。
   */
  calibrateGpsFromEntrances() {
    const floor1 = this.data.floors.find(f => f.floor === 1);
    const entrances = floor1 ? this.getEntrancesForFloor(floor1) : null;
    if (!entrances || entrances.length < 2) {
      this.gpsCalib.setReferencePoints(null, null);
      return;
    }

    const resolved = entrances
      .map(ent => {
        const gps = ENTRANCE_GPS_COORDS[ent.label];
        if (!gps) return null;
        return { lat: gps.lat, lng: gps.lng, mmX: ent.position_mm[0], mmY: ent.position_mm[1] };
      })
      .filter(Boolean);

    if (resolved.length < 2) {
      console.warn('GPS基準点用の出入口データが不足しているため、現在地表示は利用できません。');
      this.gpsCalib.setReferencePoints(null, null);
      return;
    }

    this.gpsCalib.setReferencePoints(resolved[0], resolved[1]);
  }

  toggleGpsTracking() {
    if (this.isGpsTracking) {
      this.stopGpsTracking();
      return;
    }
    this.calibrateGpsFromEntrances();
    if (!this.gpsCalib.isReady()) {
      alert('GPS基準点（東正面入口・西入口）の座標が取得できなかったため、現在地表示を利用できません。');
      return;
    }
    this.startGpsTracking();
  }

  startGpsTracking() {
    this.isGpsTracking = true;
    this.btnGpsLocate.classList.add('active');
    // 地図内のアイコンボタンになったため、テキストは常に📍アイコンのみを維持し、
    // 状態はtitle（ツールチップ）とactiveクラスの色分けで示す。
    this.btnGpsLocate.title = '現在地の表示を停止します';
    this.gpsWatcher.start();
  }

  stopGpsTracking() {
    this.isGpsTracking = false;
    this.btnGpsLocate.classList.remove('active');
    this.btnGpsLocate.title = 'GPSで取得した現在地を平面図上に表示します（位置情報の利用許可が必要です）';
    this.gpsWatcher.stop();
    if (this.layerGpsLocation) this.layerGpsLocation.innerHTML = '';
    // 現在地が無くなったので、経路表示は東正面入口起点にフォールバックする
    this.lastGpsMm = null;
    this.lastGpsFix = null;
    this.updateRoutePath();
    this.renderCampusDistancePanel();
  }

  /**
   * ユーザーがピッカーツールで実測・確定した3点の画像座標 (B3: 1794,1552 / なかもず: 1834,212 / 白鷺: 2708,913) と
   * 提供された実測GPS緯度経度データ間を誤差0.000%で100%完全に合致・整合させる2Dアフィン変換メソッド。
   */
  convertGpsToCampusWorld(lat, lng) {
    const lat0 = 34.54539577338726, lng0 = 135.50487530677495;
    const x0 = 1794, y0 = 1552;

    const dLng = (lng - lng0) * 100000;
    const dLat = (lat - lat0) * 100000;

    // 連立一次方程式から厳密計算されたアフィン行列パラメータ
    const A = 106.602;
    const B = -4.568;
    const C = -74.541;
    const D = -132.148;

    const x = Math.round(x0 + A * dLng + B * dLat);
    const y = Math.round(y0 + C * dLng + D * dLat);

    return { x, y };
  }

  handleGpsUpdate(fix) {
    const campusCenter = getLatLngCenter(GPS_CAMPUS_REFERENCE_POINTS);
    const campusRadiusM = getMaxDistanceFromCenterMeters(GPS_CAMPUS_REFERENCE_POINTS, campusCenter.lat, campusCenter.lng) + GPS_CAMPUS_MARGIN_M;
    const local = latLngToLocalMeters(fix.lat, fix.lng, GPS_BUILDING_CENTER.lat, GPS_BUILDING_CENTER.lng);
    const distM = Math.hypot(local.e, local.n);

    if (campusCenter && !isLatLngWithinDistance(fix.lat, fix.lng, GPS_BUILDING_CENTER.lat, GPS_BUILDING_CENTER.lng, campusRadiusM)) {
      this.handleGpsOutOfRange(distM);
      return;
    }

    if (this.isCampusMode) {
      // キャンパス付近地図モード時：実測GPSデータから画像アライメント位置へ誤差0.000%で完全整合描画
      const campusPt = this.convertGpsToCampusWorld(fix.lat, fix.lng);
      this.renderCampusGpsMarker(campusPt.x, campusPt.y, fix.accuracy);
    } else {
      const mm = this.gpsCalib.toMm(fix.lat, fix.lng);
      if (!mm) return;
      this.renderGpsMarker(mm.x, mm.y, fix.accuracy);
      this.lastGpsMm = mm;
    }

    this.lastGpsFix = fix;
    this.updateRoutePath();
    this.renderCampusDistancePanel();
  }

  /**
   * キャンパス付近地図モード時のGPS現在地ドット描画
   */
  renderCampusGpsMarker(x, y, accuracyMeters) {
    let layer = document.getElementById('campus-gps-location');
    if (!layer) {
      const svgCampusWorld = document.getElementById('svg-campus-world');
      if (!svgCampusWorld) return;
      const svgNS = 'http://www.w3.org/2000/svg';
      layer = document.createElementNS(svgNS, 'g');
      layer.setAttribute('id', 'campus-gps-location');
      svgCampusWorld.appendChild(layer);
    }
    const svgNS = 'http://www.w3.org/2000/svg';
    layer.innerHTML = '';

    const markerGroup = document.createElementNS(svgNS, 'g');
    layer.appendChild(markerGroup);

    // 外枠パルスリング
    const halo = document.createElementNS(svgNS, 'circle');
    halo.setAttribute('cx', x);
    halo.setAttribute('cy', y);
    halo.setAttribute('r', '75');
    halo.setAttribute('class', 'gps-marker-pulse');
    halo.setAttribute('fill', 'rgba(14, 165, 233, 0.35)');
    markerGroup.appendChild(halo);

    // 白フチリング
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', x);
    ring.setAttribute('cy', y);
    ring.setAttribute('r', '40');
    ring.setAttribute('fill', '#ffffff');
    markerGroup.appendChild(ring);

    // 青中心ドット
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', '30');
    dot.setAttribute('fill', '#0ea5e9');
    dot.setAttribute('stroke', '#ffffff');
    dot.setAttribute('stroke-width', '8');
    markerGroup.appendChild(dot);
  }

  /**
   * B3棟から離れた場所にいると判定した場合の処理。
   * そのまま表示を続けても意味が無い（別の場所にいる／GPS誤差が大きすぎる）ため、
   * 追跡を停止してユーザーに知らせる。
   * ・現在地表示ON中に敷地外へ移動した場合 → 追跡中に自動停止
   * ・そもそもB3棟から離れた場所でONにした場合 → 最初のfixで即座に停止
   */
  handleGpsOutOfRange(distM) {
    alert(`現在地が中百舌鳥キャンパス周辺の範囲外（約${Math.round(distM)}m）にあるため、現在地表示を停止しました。キャンパス内で再度お試しください。`);
    this.stopGpsTracking();
  }

  handleGpsError(err) {
    alert(err.message);
    this.stopGpsTracking();
  }

  /**
   * 現在地マーカーを平面図(SVG)上に描画する。
   * 建物の全フロアは同一のXY座標系を共有しているため、フロアを切り替えても
   * このレイヤーはクリアされず、そのままXY位置が引き継がれる
   * （高さ方向の情報は無いため、実際にどの階にいるかは利用者自身の判断による）。
   */
  renderGpsMarker(x, y, accuracyMeters) {
    if (!this.layerGpsLocation) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    this.layerGpsLocation.innerHTML = '';

    // マーカー全体を1つのグループにまとめ、ドロップシャドウを一括で掛けることで、
    // 部屋のポリゴンや経路線など他の地図要素から視覚的に切り離し、独立して
    // 目立つ存在として認識できるようにする（#layer-gps-location はSVG内で
    // 最後に描画される最前面レイヤーのため、常に他の要素より手前に表示される）。
    const markerGroup = document.createElementNS(svgNS, 'g');
    markerGroup.setAttribute('filter', 'url(#gps-marker-shadow)');
    this.layerGpsLocation.appendChild(markerGroup);

    // 精度円：GPSのaccuracy(メートル)をキャリブレーションのスケールでmmに換算して表示
    if (this.gpsCalib.mmPerMeter && accuracyMeters) {
      const rMm = accuracyMeters * this.gpsCalib.mmPerMeter;
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', Math.max(rMm, 300));
      circle.setAttribute('fill', 'rgba(14, 165, 233, 0.15)');
      circle.setAttribute('stroke', 'rgba(14, 165, 233, 0.4)');
      circle.setAttribute('stroke-width', '80');
      markerGroup.appendChild(circle);
    }

    // 現在地ドット（パルスする外側ハロー＋白フチ付き青丸）。
    // 他の地図要素（部屋の色・経路線など）と紛れないよう、以前よりひと回り
    // 大きくし、外周にコントラスト用の白いリングを追加している。
    const halo = document.createElementNS(svgNS, 'circle');
    halo.setAttribute('cx', x);
    halo.setAttribute('cy', y);
    halo.setAttribute('r', '1400');
    halo.setAttribute('class', 'gps-marker-pulse');
    halo.setAttribute('fill', 'rgba(14, 165, 233, 0.35)');
    markerGroup.appendChild(halo);

    // 白フチのコントラストリング（マーカーを地図の背景色から独立させる）
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', x);
    ring.setAttribute('cy', y);
    ring.setAttribute('r', '700');
    ring.setAttribute('fill', '#ffffff');
    markerGroup.appendChild(ring);

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', '560');
    dot.setAttribute('fill', '#0ea5e9');
    dot.setAttribute('stroke', '#ffffff');
    dot.setAttribute('stroke-width', '180');
    markerGroup.appendChild(dot);

    // 「現在地」ラベル：ドットの真上に常時表示し、他の部屋名・番号ラベルと
    // 混同されないよう、独立したピル型の背景を付けて強調する。
    const labelY = y - 2500;
    const labelBg = document.createElementNS(svgNS, 'rect');
    labelBg.setAttribute('class', 'gps-marker-label-bg');
    labelBg.setAttribute('x', x - 1450);
    labelBg.setAttribute('y', labelY - 620);
    labelBg.setAttribute('width', '2900');
    labelBg.setAttribute('height', '900');
    labelBg.setAttribute('rx', '450');
    labelBg.setAttribute('fill', '#0ea5e9');
    labelBg.setAttribute('stroke', '#ffffff');
    labelBg.setAttribute('stroke-width', '80');
    markerGroup.appendChild(labelBg);

    const labelText = document.createElementNS(svgNS, 'text');
    labelText.setAttribute('class', 'gps-marker-label-text');
    labelText.setAttribute('x', x);
    labelText.setAttribute('y', labelY - 60);
    labelText.setAttribute('text-anchor', 'middle');
    labelText.setAttribute('dominant-baseline', 'middle');
    labelText.setAttribute('fill', '#ffffff');
    labelText.setAttribute('font-size', '620');
    labelText.textContent = '📍現在地';
    markerGroup.appendChild(labelText);

    // ラベルとドットをつなぐ小さな三角形の吹き出しテール
    const tail = document.createElementNS(svgNS, 'polygon');
    tail.setAttribute('points', `${x - 260},${labelY - 40} ${x + 260},${labelY - 40} ${x},${labelY + 340}`);
    tail.setAttribute('fill', '#0ea5e9');
    markerGroup.appendChild(tail);
  }

  /**
   * キャンパス付近地図モードの左上に表示する距離パネルを更新する。
   * 現在地（GPS測位中の緯度経度）から、最寄り駅3件（GPS_CAMPUS_REFERENCE_POINTS）
   * および B3棟（GPS_BUILDING_CENTER）までの直線距離をkm単位で算出して表示する。
   * 徒歩の目安時間は「徒歩1分＝直線距離60m」の換算で概算する
   * （実際の道のりではなく直線距離のため、あくまで目安）。
   * GPS未測位の場合は、案内メッセージを表示する。
   */
  renderCampusDistancePanel() {
    if (!this.campusDistancePanel) return;

    if (!this.lastGpsFix) {
      this.campusDistancePanel.style.display = 'none';
      this.campusDistancePanel.innerHTML = '';
      return;
    }

    this.campusDistancePanel.style.display = '';

    const WALK_METERS_PER_MIN = 60; // 徒歩1分 ＝ 直線距離60m換算

    // 表示順は「中百舌鳥駅・なかもず駅・白鷺駅・B3棟(高専)」の2列×2行固定。
    // GPS_CAMPUS_REFERENCE_POINTS の並び順に依存せず label で個別に引く。
    const findRef = (label) => GPS_CAMPUS_REFERENCE_POINTS.find(pt => pt.label === label);

    const formatDistanceCell = (label, distM, highlight) => {
      const km = (distM / 1000).toFixed(distM < 10000 ? 2 : 1);
      const walkMin = Math.max(1, Math.round(distM / WALK_METERS_PER_MIN));
      return `
        <div class="cdp-cell${highlight ? ' cdp-highlight' : ''}">
          <span class="cdp-label">${label}</span>
          <span class="cdp-value">${km} km<span class="cdp-walk">（${walkMin}分）</span></span>
        </div>
      `;
    };

    const distanceToRefM = (pt) => {
      const d = latLngToLocalMeters(this.lastGpsFix.lat, this.lastGpsFix.lng, pt.lat, pt.lng);
      return Math.hypot(d.e, d.n);
    };

    const nakamozu = findRef('中百舌鳥');
    const nakamozuHira = findRef('なかもず');
    const shirasagi = findRef('白鷺');

    const b3Local = latLngToLocalMeters(this.lastGpsFix.lat, this.lastGpsFix.lng, GPS_BUILDING_CENTER.lat, GPS_BUILDING_CENTER.lng);
    const b3DistM = Math.hypot(b3Local.e, b3Local.n);

    const cells = [
      nakamozu ? formatDistanceCell('🚉 中百舌鳥駅', distanceToRefM(nakamozu)) : '',
      nakamozuHira ? formatDistanceCell('🚉 なかもず駅', distanceToRefM(nakamozuHira)) : '',
      shirasagi ? formatDistanceCell('🚉 白鷺駅', distanceToRefM(shirasagi)) : '',
      formatDistanceCell('🏢 B3棟(高専)', b3DistM, true)
    ].join('');

    this.campusDistancePanel.innerHTML = `
      <div class="cdp-title">📍 現在地からの距離</div>
      <div class="cdp-grid">${cells}</div>
    `;
  }

  // ========================================================================
  // 現在地→目的部屋の最短経路表示機能
  // ========================================================================
  // 検索結果／ダイレクトリンクで目的の部屋（searchPinRoomId）が表示されている
  // 間、現在地（GPS測位中ならその位置、未測位ならフォールバックとして
  // 東正面入口）からその部屋までの最短経路を平面図上に線で表示する。
  // 経路探索そのものは pathfinding.js の RoutePlanner（グリッドベースA*）が担う。
  // ========================================================================

  /**
   * 経路のスタート地点（平面図mm座標）を決定する。
   * 高さ方向の判定ができないため、GPS現在地ではなく
   * 1F「東正面入口」を常に起点として使う。
   * （東正面入口はどのフロアを表示中でも、全フロア共通のXY座標系上の同じ点として使える）。
   */
  getRouteStartPointMm() {
    const floor1 = this.data.floors.find(f => f.floor === 1);
    const entrances = floor1 ? this.getEntrancesForFloor(floor1) : null;
    const east = entrances && entrances.find(e => e.label === '東正面入口');
    if (east) {
      return { x: east.position_mm[0], y: east.position_mm[1] };
    }
    return null;
  }

  chooseBestEntranceRoute(targetFloorNum, targetRoomId) {
    const floor1 = this.data.floors.find(f => f.floor === 1);
    if (!floor1) return null;
    const entrances = this.getEntrancesForFloor(floor1);
    if (!entrances || entrances.length === 0) return null;

    let best = null;
    entrances.forEach(ent => {
      const startMm = { x: ent.position_mm[0], y: ent.position_mm[1] };
      const route = this.routePlanner.findMultiFloorRoute(
        this.data.floors,
        1,
        startMm,
        targetFloorNum,
        targetRoomId
      );
      if (!route) return;
      const score = route.totalDistanceMm;
      if (!best || score < best.score) {
        best = { score, route, entrance: ent };
      }
    });

    if (!best) return null;
    this.routeStartEntrance = best.entrance;
    return best.route;
  }

  /**
   * searchPinRoomId（検索結果／ダイレクトリンクでハイライト中の部屋）に対して、
   * 経路を再計算し、現在表示中のフロア（this.currentFloorNum）に該当する区間だけを描画する。
   * 目的の部屋が利用者の実際のフロア（this.userFloorNum）と異なる場合は、
   * pathfinding.jsのRoutePlannerが「階段」部屋を介したフロアをまたぐ経路
   * （ダイクストラ法）を探索する。
   * 経路探索の起点フロアには、表示中のフロア（this.currentFloorNum）ではなく
   * this.userFloorNumを使う。検索結果クリック／ダイレクトリンクでは目的階の
   * 平面図を画面に表示するためにthis.currentFloorNumが目的階へ切り替わるが、
   * それをそのまま起点フロアとして使うと「起点＝目的階」になってしまい、
   * 階段を経由しない（＝実際の階段位置を無視した）経路になってしまうため。
   * this.userFloorNumはフロアタブの手動クリック時のみ更新され、検索結果／
   * ダイレクトリンクによる自動切り替えでは更新されない（switchToFloor()参照）。
   * GPSには高度の情報が無いため、実際にどの階にいるかはこの「手動で選んだ
   * 最後のフロア」を利用者自身の判断として代用する。
   */
  updateRoutePath() {
    if (!this.layerRoutePath) return;
    this.layerRoutePath.innerHTML = '';

    if (!this.isRouteVisible || !this.searchPinRoomId) {
      this.lastRoute = null;
      if (this.renderer3D) this.renderer3D.setRoute(null);
      return;
    }

    // 目的の部屋がどのフロアにあるかを、全フロアを対象に探す
    let targetFloorNum = null;
    for (const f of this.data.floors) {
      if (f.rooms.some(r => r.room_id === this.searchPinRoomId)) {
        targetFloorNum = f.floor;
        break;
      }
    }
    if (targetFloorNum === null) {
      this.lastRoute = null;
      if (this.renderer3D) this.renderer3D.setRoute(null);
      return; // データ不整合等で部屋が見つからない場合
    }

    const route = this.chooseBestEntranceRoute(targetFloorNum, this.searchPinRoomId);
    if (!route) {
      this.lastRoute = null;
      if (this.renderer3D) this.renderer3D.setRoute(null);
      return; // 到達不可能（階段の対応関係が取れない等）の場合は何も描画しない
    }

    this.lastRoute = route;
    if (this.renderer3D) this.renderer3D.setRoute(this.isRouteVisible ? this.lastRoute : null);

    if (this.is3DMode) return; // 3D表示では2Dレイヤの経路線は描かず、3Dレンダラーへのみ反映する

    const seg = route.segments.find(s => s.floor === this.currentFloorNum);
    if (!seg) return; // 経路がこのフロアを通らない場合は何も描画しない

    this.renderRoutePath(seg.points, seg.distanceMm, seg.enter, seg.exit);
  }

  /**
   * @param {number[][]} points 経路のmm座標列（このフロア内の区間）
   * @param {number} distanceMm この区間の概算距離(mm)
   * @param {?{fromFloor:number,label:string}} enter 別フロアの階段からこのフロアに入ってきた場合の情報（起点そのものならnull）
   * @param {?{toFloor:number,label:string}} exit このフロアの階段から別フロアへ抜ける場合の情報（目的の部屋に到着する最終区間ならnull）
   */
  renderRoutePath(points, distanceMm, enter = null, exit = null) {
    if (!this.layerRoutePath || !points || points.length === 0) return;
    const svgNS = 'http://www.w3.org/2000/svg';

    if (points.length >= 2) {
      const pointsAttr = points.map(p => p.join(',')).join(' ');

      // 縁取り（背景とのコントラスト確保用の太い白線を下に敷く）
      const outline = document.createElementNS(svgNS, 'polyline');
      outline.setAttribute('points', pointsAttr);
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', 'rgba(15, 23, 42, 0.85)');
      outline.setAttribute('stroke-width', '520');
      outline.setAttribute('stroke-linecap', 'round');
      outline.setAttribute('stroke-linejoin', 'round');
      this.layerRoutePath.appendChild(outline);

      // 経路本体（進行方向に流れるアニメーション付きの破線）
      const line = document.createElementNS(svgNS, 'polyline');
      line.setAttribute('points', pointsAttr);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', '#22c55e');
      line.setAttribute('stroke-width', '280');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('stroke-dasharray', '650 450');
      line.setAttribute('class', 'route-path-line');
      this.layerRoutePath.appendChild(line);
    }

    const [sx, sy] = points[0];
    const [ex, ey] = points[points.length - 1];

    // 他フロアの階段への出入りが無い、他フロアの通り道でしかない1点だけの区間
    // （例：2Fから4Fへ階段で向かう途中の3F）は、通過マーカーだけを表示する。
    if (points.length === 1 && enter && exit) {
      this.renderStairTransitionMarker(sx, sy, enter.fromFloor, exit.toFloor, exit.label);
      return;
    }

    if (!enter) {
      // このフロアが経路の起点（現在地／東正面入口フォールバック）：緑の出発ドット＋距離ラベル
      const startDot = document.createElementNS(svgNS, 'circle');
      startDot.setAttribute('cx', sx);
      startDot.setAttribute('cy', sy);
      startDot.setAttribute('r', '380');
      startDot.setAttribute('fill', '#22c55e');
      startDot.setAttribute('stroke', '#ffffff');
      startDot.setAttribute('stroke-width', '150');
      this.layerRoutePath.appendChild(startDot);

      // 距離の目安（概算・小数点以下は四捨五入）をスタート地点付近に表示
      const distText = document.createElementNS(svgNS, 'text');
      distText.setAttribute('x', sx);
      distText.setAttribute('y', sy - 900);
      distText.setAttribute('text-anchor', 'middle');
      distText.setAttribute('font-size', '900');
      distText.setAttribute('font-weight', '700');
      distText.setAttribute('fill', '#22c55e');
      distText.setAttribute('class', 'route-distance-label');
      distText.textContent = `約${Math.round(distanceMm / 1000)}m`;
      this.layerRoutePath.appendChild(distText);
    } else {
      // 別フロアの階段からこのフロアに入ってきた地点
      this.renderStairTransitionMarker(sx, sy, enter.fromFloor, this.currentFloorNum, enter.label);
    }

    if (exit) {
      // このフロアの階段から別フロアへ抜ける地点
      this.renderStairTransitionMarker(ex, ey, this.currentFloorNum, exit.toFloor, exit.label);
    }
  }

  /**
   * フロアをまたぐ経路案内で、階段の乗り継ぎ地点に「上り/下り」と行き先の階数が
   * 分かるマーカーを描画する。
   */
  renderStairTransitionMarker(x, y, fromFloor, toFloor, stairLabel) {
    if (!this.layerRoutePath) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const isUp = toFloor > fromFloor;
    const arrow = isUp ? '🔼' : '🔽';

    const halo = document.createElementNS(svgNS, 'circle');
    halo.setAttribute('cx', x);
    halo.setAttribute('cy', y);
    halo.setAttribute('r', '620');
    halo.setAttribute('fill', 'rgba(15, 23, 42, 0.85)');
    halo.setAttribute('stroke', '#22c55e');
    halo.setAttribute('stroke-width', '120');
    this.layerRoutePath.appendChild(halo);

    const icon = document.createElementNS(svgNS, 'text');
    icon.setAttribute('x', x);
    icon.setAttribute('y', y);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'middle');
    icon.setAttribute('font-size', '700');
    icon.textContent = arrow;
    this.layerRoutePath.appendChild(icon);

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', y - 950);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '800');
    label.setAttribute('font-weight', '700');
    label.setAttribute('fill', '#22c55e');
    label.setAttribute('class', 'route-distance-label');
    label.textContent = `${stairLabel}（${toFloor}Fへ）`;
    this.layerRoutePath.appendChild(label);
  }

  /**
   * 検索モード（閲覧専用）で部屋をクリックした時に表示する、入力欄の無い読み取り専用の詳細カード。
   * 通常部屋データは人事異動・組織改編があった時以外は変更しないため、ここでは編集は一切できない。
   */
  renderEditorCardReadOnly(room) {
    const catInfo = CATEGORY_COLORS[room.category];
    const affKey = room.affiliation || 'other';
    const affInfo = AFFILIATION_COLORS[affKey] || AFFILIATION_COLORS.other;
    const numText = room.display_number || room.room_number || '-';
    const nameText = room.display_label || room.room_name || '-';
    const teacherText = (room.teachers || []).join('、');
    const affBadgeStyle = affInfo.color2
      ? `background: repeating-linear-gradient(45deg, ${affInfo.color} 0 4px, ${affInfo.color2} 4px 8px);`
      : `background: ${affInfo.color};`;

    const isMobile = this.isMobileViewport();
    const closeBtnHtml = isMobile
      ? `<button type="button" class="btn-close-room-card" id="btn-close-room-card" title="部屋の選択を解除して閉じる">✖ 閉じる</button>`
      : '';

    this.roomEditorCard.innerHTML = `
      <div class="editor-field compact-heading">
        <span class="editor-label heading-label">部屋番号</span>
        <div class="editor-readonly-value room-number">${numText}</div>
        <span class="editor-label heading-label">部屋名称</span>
        <div class="editor-readonly-value room-name">${nameText}</div>
        ${closeBtnHtml}
      </div>
      <div class="editor-fields-grid">
        <div class="editor-field compact-row">
          <span class="editor-label">🏷️ カテゴリ</span>
          <div class="editor-readonly-value">${catInfo ? catInfo.name : room.category}</div>
        </div>
        <div class="editor-field compact-row">
          <span class="editor-label">🏢 所属</span>
          <div class="editor-readonly-value" style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:14px; height:14px; flex:0 0 auto; border-radius:4px; ${affBadgeStyle} border:1px solid rgba(255,255,255,0.5);"></span>
            ${affInfo.name}
          </div>
        </div>
      </div>
      ${teacherText ? `
      <div class="editor-field compact-row">
        <span class="editor-label">👤 教員</span>
        <div class="editor-readonly-value">${teacherText}</div>
      </div>` : ''}
      <div class="editor-field">
        <button type="button" class="btn-secondary" id="btn-copy-room-link" style="width:100%;" title="この部屋への直接リンクをコピーします。メール等に貼り付けると、開いた人の画面で自動的にこの部屋が📍付きでハイライト表示されます。">🔗 この部屋へのリンクをコピー</button>
      </div>
      <div class="help-tip">
        💡 データを変更するには「✏️ 編集モード」に切り替えてください（人事異動・組織改編があった時のみ）。
      </div>
    `;

    const copyLinkBtn = document.getElementById('btn-copy-room-link');
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        this.copyRoomDirectLink(this.currentFloorNum, room.room_id, copyLinkBtn);
      });
    }

    const closeBtn = document.getElementById('btn-close-room-card');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.selectedRoomIds.clear();
        this.renderHighlight();
        this.renderEditorCard();
      });
    }
  }

  renderEditorCard() {
    const roomEditorSection = this.roomEditorSectionTitle ? this.roomEditorSectionTitle.closest('section') : null;

    // 部屋情報カードを表示するのは「部屋が選択されており」かつ「平面図上の部屋を直接クリックした時（または編集モード中）」のみ。
    // 検索の後はカードを表示せず、マップ上の📍とハイライト表示のみにする。
    const shouldShowCard = this.selectedRoomIds.size > 0 && (this.isEditMode || this.isRoomSelectedByDirectClick);

    if (!shouldShowCard) {
      if (this.isMobileViewport()) {
        if (roomEditorSection) roomEditorSection.style.display = 'none';
        this.roomEditorCard.innerHTML = '';
        return;
      }
      if (roomEditorSection) roomEditorSection.style.display = '';
      this.roomEditorCard.innerHTML = this.isEditMode
        ? `
        <div class="empty-state">
          平面図上の部屋をクリックすると<br>部屋番号・名前・横幅/縦幅・属性の訂正ができます<br><small>(Shift+クリックで複数選択)</small>
        </div>
      `
        : `
        <div class="empty-state">
          平面図上の部屋をクリックすると<br>部屋の詳細情報を確認できます
        </div>
      `;
      return;
    }

    if (roomEditorSection) roomEditorSection.style.display = '';

    const floorObj = this.data.floors.find(f => f.floor === this.currentFloorNum);

    if (this.selectedRoomIds.size === 1) {
      const roomId = Array.from(this.selectedRoomIds)[0];
      const room = floorObj.rooms.find(r => r.room_id === roomId);
      if (!room) return;

      // 検索モード（閲覧専用）では、入力欄のない読み取り専用の詳細カードだけを表示する
      if (!this.isEditMode) {
        this.renderEditorCardReadOnly(room);
        return;
      }

      const catOptionsHtml = Object.keys(CATEGORY_COLORS).map(catKey => {
        const info = CATEGORY_COLORS[catKey];
        const isSelected = room.category === catKey ? 'selected' : '';
        return `<option value="${catKey}" ${isSelected}>${info.name} (${catKey})</option>`;
      }).join('');

      const currentAffiliation = room.affiliation || 'other';
      const affOptionsHtml = Object.keys(AFFILIATION_COLORS).map(affKey => {
        const info = AFFILIATION_COLORS[affKey];
        const isSelected = currentAffiliation === affKey ? 'selected' : '';
        return `<option value="${affKey}" ${isSelected}>${info.name}</option>`;
      }).join('');

      const b = room.bounding_box_mm;

      this.roomEditorCard.innerHTML = `
        <div class="editor-field">
          <span class="editor-label">部屋番号 (Room Number)</span>
          <input type="text" class="editor-input" id="edit-room-num" value="${room.display_number || room.room_number}">
        </div>
        <div class="editor-field">
          <span class="editor-label">部屋名称 (Room Name)</span>
          <input type="text" class="editor-input" id="edit-room-name" value="${room.display_label || room.room_name}">
        </div>

        <div class="editor-field">
          <span class="editor-label">📐 部屋サイズ・範囲調整 (mm単位)</span>
          <div class="editor-row-2col">
            <div>
              <span class="editor-label">↔️ 横幅 (Width)</span>
              <input type="number" class="editor-input" id="edit-room-w" value="${Math.round(b.width)}" step="500">
            </div>
            <div>
              <span class="editor-label">↕️ 縦幅 (Height)</span>
              <input type="number" class="editor-input" id="edit-room-h" value="${Math.round(b.height)}" step="500">
            </div>
          </div>
        </div>

        <div class="editor-field">
          <div class="editor-row-2col">
            <div>
              <span class="editor-label">📍 X座標 (X Position)</span>
              <input type="number" class="editor-input" id="edit-room-x" value="${Math.round(b.x)}" step="500">
            </div>
            <div>
              <span class="editor-label">📍 Y座標 (Y Position)</span>
              <input type="number" class="editor-input" id="edit-room-y" value="${Math.round(b.y)}" step="500">
            </div>
          </div>
        </div>

        <div class="editor-field">
          <span class="editor-label">🏷️ 用途・カテゴリ属性 (Category Attribute)</span>
          <select class="editor-input" id="edit-room-cat">
            ${catOptionsHtml}
          </select>
        </div>

        <div class="editor-field">
          <span class="editor-label">🏢 所属 (Affiliation) — 部屋の枠色に反映されます</span>
          <div class="editor-row-2col" style="align-items:center; grid-template-columns: 1fr auto;">
            <select class="editor-input" id="edit-room-aff">
              ${affOptionsHtml}
            </select>
            <span id="edit-room-aff-badge" style="display:inline-block; width:22px; height:22px; border-radius:4px; margin-left:8px; background:${AFFILIATION_COLORS[currentAffiliation].color2 ? `repeating-linear-gradient(45deg, ${AFFILIATION_COLORS[currentAffiliation].color} 0 4px, ${AFFILIATION_COLORS[currentAffiliation].color2} 4px 8px)` : AFFILIATION_COLORS[currentAffiliation].color}; border:1px solid rgba(255,255,255,0.5);"></span>
          </div>
        </div>

        <div class="editor-field">
          <span class="editor-label">👤 担当教員 (Faculty / Teacher) — 複数名は「、」または「,」区切り</span>
          <input type="text" class="editor-input" id="edit-room-teacher" value="${(room.teachers || []).join('、')}" placeholder="例: 山田太郎、鈴木花子">
        </div>

        <div class="editor-checkbox-row">
          <label class="layer-toggle-item">
            <input type="checkbox" id="edit-show-text" ${room.show_text !== false ? 'checked' : ''}>
            <span>文字を表示</span>
          </label>
          <label class="layer-toggle-item">
            <input type="checkbox" id="edit-visible" ${room.visible !== false ? 'checked' : ''}>
            <span>部屋を表示</span>
          </label>
        </div>

        <div class="editor-field">
          <button type="button" class="btn-secondary" id="btn-copy-room-link" style="width:100%;" title="この部屋への直接リンクをコピーします。メール等に貼り付けると、開いた人の画面で自動的にこの部屋が📍付きでハイライト表示されます。">🔗 この部屋へのリンクをコピー</button>
        </div>
      `;

      document.getElementById('edit-room-num').addEventListener('input', (e) => {
        room.display_number = e.target.value;
        room.room_number = e.target.value;
        this.updateSingleRoomLabelFast(room);
        this.savePersistedData();
      });
      document.getElementById('edit-room-name').addEventListener('input', (e) => {
        room.display_label = e.target.value;
        room.room_name = e.target.value;
        this.updateSingleRoomLabelFast(room);
        this.savePersistedData();
      });

      const updateSize = () => {
        const newW = Math.max(500, parseFloat(document.getElementById('edit-room-w').value) || 1000);
        const newH = Math.max(500, parseFloat(document.getElementById('edit-room-h').value) || 1000);
        const newX = parseFloat(document.getElementById('edit-room-x').value) || 0;
        const newY = parseFloat(document.getElementById('edit-room-y').value) || 0;

        this.updateRoomShapeFromDimensions(room, newX, newY, newW, newH);
      };

      document.getElementById('edit-room-w').addEventListener('input', updateSize);
      document.getElementById('edit-room-h').addEventListener('input', updateSize);
      document.getElementById('edit-room-x').addEventListener('input', updateSize);
      document.getElementById('edit-room-y').addEventListener('input', updateSize);

      document.getElementById('edit-room-cat').addEventListener('change', (e) => {
        room.category = e.target.value;
        delete room.svg_fill;
        this.renderRoomsOnly();
        this.savePersistedData();
      });
      document.getElementById('edit-room-aff').addEventListener('change', (e) => {
        room.affiliation = e.target.value;
        const info = AFFILIATION_COLORS[room.affiliation] || AFFILIATION_COLORS.other;
        const badge = document.getElementById('edit-room-aff-badge');
        if (badge) {
          badge.style.background = info.color2
            ? `repeating-linear-gradient(45deg, ${info.color} 0 4px, ${info.color2} 4px 8px)`
            : info.color;
        }
        this.renderRoomsOnly();
        this.savePersistedData();
      });
      document.getElementById('edit-room-teacher').addEventListener('input', (e) => {
        room.teachers = e.target.value
          .split(/[、,]/)
          .map(s => s.trim())
          .filter(s => s.length > 0);
        this.savePersistedData();
      });
      document.getElementById('edit-show-text').addEventListener('change', (e) => {
        room.show_text = e.target.checked;
        this.updateSingleRoomLabelFast(room);
      });
      document.getElementById('edit-visible').addEventListener('change', (e) => {
        room.visible = e.target.checked;
        this.renderRoomsOnly();
        this.renderLabelsOnly();
        this.savePersistedData();
      });
      const copyLinkBtn = document.getElementById('btn-copy-room-link');
      if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
          this.copyRoomDirectLink(this.currentFloorNum, room.room_id, copyLinkBtn);
        });
      }
    } else {
      this.roomEditorCard.innerHTML = `
        <div class="empty-state">
          <strong>${this.selectedRoomIds.size} 個の部屋を選択中</strong><br>
          上の「🔗 選択した部屋を結合」ボタンを押すと<br>1つの部屋区画にまとまります
        </div>
      `;
    }
  }

  mergeSelectedRooms() {
    if (!this.isEditMode) return;
    if (this.selectedRoomIds.size < 2) {
      alert('結合するには、Shift+クリックで2つ以上の部屋を選択してください。');
      return;
    }

    const floorObj = this.data.floors.find(f => f.floor === this.currentFloorNum);
    
    // Strict Filter: Ensure selected room IDs are converted to Array and thoroughly removed
    const selectedIdArray = Array.from(this.selectedRoomIds);
    const roomsToMerge = floorObj.rooms.filter(r => selectedIdArray.includes(r.room_id));

    if (roomsToMerge.length < 2) {
      alert('選択された部屋の一部が見つかりませんでした。再度選択してください。');
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    roomsToMerge.forEach(r => {
      const b = r.bounding_box_mm;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    });

    const newWidth = maxX - minX;
    const newHeight = maxY - minY;
    const newCenterX = minX + newWidth / 2.0;
    const newCenterY = minY + newHeight / 2.0;

    const mergedNum = roomsToMerge.map(r => r.display_number || r.room_number).join('-');
    const mergedName = roomsToMerge.map(r => r.display_label || r.room_name).join(' / ');
    const primaryCat = roomsToMerge[0].category;
    const primaryAffiliation = roomsToMerge[0].affiliation || 'other';
    const mergedTeachers = [...new Set(roomsToMerge.flatMap(r => r.teachers || []))];

    const mergedRoom = {
      room_id: `${this.currentFloorNum}F_MERGED_${Date.now()}`,
      room_number: mergedNum,
      room_name: mergedName,
      display_number: mergedNum,
      display_label: mergedName,
      category: primaryCat,
      affiliation: primaryAffiliation,
      teachers: mergedTeachers,
      center_point_mm: [newCenterX, newCenterY],
      bounding_box_mm: { x: minX, y: minY, width: newWidth, height: newHeight },
      polygon_mm: [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY]
      ]
    };

    // 1. Permanently remove all original merged rooms from dataset
    floorObj.rooms = floorObj.rooms.filter(r => !selectedIdArray.includes(r.room_id));
    
    // 2. Also remove internal partition CAD wall lines between merged rooms
    if (floorObj.walls) {
      floorObj.walls = floorObj.walls.filter(w => {
        const isInsideHoriz = (minX + 300 < w.x) && (w.x + w.w < maxX - 300);
        const isInsideVert = (minY + 300 < w.y) && (w.y + w.h < maxY - 300);
        return !(isInsideHoriz && isInsideVert);
      });
    }

    // 3. Add new merged room
    floorObj.rooms.push(mergedRoom);

    this.selectedRoomIds.clear();
    this.selectedRoomIds.add(mergedRoom.room_id);

    this.renderFloor(this.currentFloorNum);
    this.savePersistedData();
    alert(`選択した部屋を完全結合しました！\n結合後の部屋名: ${mergedName}`);
  }

  deleteSelectedRooms() {
    if (!this.isEditMode) return;
    if (this.selectedRoomIds.size === 0) {
      alert('削除する部屋を選択してください。');
      return;
    }

    const floorObj = this.data.floors.find(f => f.floor === this.currentFloorNum);
    const selectedIdArray = Array.from(this.selectedRoomIds);

    floorObj.rooms = floorObj.rooms.filter(r => !selectedIdArray.includes(r.room_id));

    this.selectedRoomIds.clear();
    this.renderFloor(this.currentFloorNum);
    this.savePersistedData();
  }

  // 検索結果クリック時の遷移先を、現在の表示モードに応じて切り替える。
  // 立体表示中はフロアを切り替えず該当部屋をハイライトするだけ、
  // 平面図表示中は該当フロアに切り替えてハイライト＋📍を落とす。
  focusSearchResult(floor, room) {
    if (this.is3DMode) {
      // 3D表示中に選んだ部屋も、後で2Dに戻った時／3Dを開き直した時に
      // 同じハイライトが引き継がれるよう、2D側の選択状態も合わせて更新しておく
      this.currentFloorNum = floor;
      this.selectedRoomIds.clear();
      this.selectedRoomIds.add(room.room_id);
      this.searchPinRoomId = room.room_id;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.getAttribute('data-floor'), 10) === floor);
      });

      if (this.renderer3D) {
        this.renderer3D.highlightRoom(floor, room.room_id);
      }
      this.updateRoutePath();
      this.renderEditorCard();
    } else {
      this.switchToFloor(floor, room.room_id);
    }
  }

  /**
   * 検索結果の項目を選択した後、ドロップダウン（検索結果リスト）を閉じる。
   * 選択後もリストを開いたままだと、特にスマホ表示でサイドバーが場所を取り、
   * 平面図の表示領域を圧迫してしまうため、選択と同時にリストをたたむ。
   * 検索キーワード自体（入力欄の値）は保持し、フォーカスだけ外す
   * （スマホでは仮想キーボードも閉じ、表示領域がさらに広がる）。
   */
  collapseSearchResults() {
    if (this.searchResults) {
      this.searchResults.innerHTML = '';
      this.searchResults.style.display = 'none';
    }
    if (this.searchInput) this.searchInput.blur();
  }

  handleSearch(query) {
    this.searchResults.innerHTML = '';
    if (!query) {
      this.searchResults.style.display = 'none';
      return;
    }

    // IME入力で全角数字・英字になっていても検索できるよう半角に正規化してから比較する
    const normalize = (str) => (str || '')
      .toString()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .toLowerCase()
      .trim();

    const q = normalize(query);
    if (!q) {
      this.searchResults.style.display = 'none';
      return;
    }

    // 現在表示中のフロアだけでなく、全フロアを串刺しで検索する
    const allMatches = [];
    this.data.floors.forEach(floorObj => {
      floorObj.rooms.forEach(r => {
        const affInfo = AFFILIATION_COLORS[r.affiliation || 'other'];
        // 「用途・カテゴリ」は検索対象に含めない（部屋番号・名称・所属・担当教員のみで検索する）
        const searchableFields = [
          r.room_number,
          r.room_name,
          r.display_number,
          r.display_label,
          r.affiliation,
          affInfo ? affInfo.name : '',
          (r.teachers || []).join(' ')
        ];
        if (searchableFields.some(f => normalize(f).includes(q))) {
          allMatches.push({ floor: floorObj.floor, room: r });
        }
      });
    });

    // フロア順 → 部屋番号順に並べる
    allMatches.sort((a, b) => {
      if (a.floor !== b.floor) return a.floor - b.floor;
      const an = a.room.display_number || a.room.room_number || '';
      const bn = b.room.display_number || b.room.room_number || '';
      return an.toString().localeCompare(bn.toString(), 'ja');
    });

    allMatches.forEach(({ floor, room }) => {
      const catInfo = CATEGORY_COLORS[room.category];
      const numText = room.display_number || room.room_number;
      const nameText = room.display_label || room.room_name;
      const catText = catInfo ? catInfo.name : room.category;
      const teacherText = (room.teachers || []).join('、');

      const item = document.createElement('div');
      item.className = 'search-item';
      item.innerHTML = `
        <span><strong class="search-item-floor">${floor}F</strong> <strong>${numText}</strong> ${nameText}${teacherText ? ` <span style="color:var(--text-muted);">(${teacherText})</span>` : ''}</span>
        <span style="display:flex; align-items:center; gap:8px;">
          <span style="color:var(--text-muted);">${catText}</span>
          <button type="button" class="search-item-link-btn" title="この部屋への直接リンクをコピー" style="background:none; border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:2px 6px; color:var(--text-muted); cursor:pointer; font-size:12px; line-height:1.4;">🔗</button>
        </span>
      `;
      const linkBtn = item.querySelector('.search-item-link-btn');
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyRoomDirectLink(floor, room.room_id, linkBtn);
      });
      item.addEventListener('click', () => {
        this.focusSearchResult(floor, room);
        // 選択したらドロップダウン（検索結果リスト）を閉じて、平面図の
        // 表示領域を圧迫しないようにする（特にスマホでは影響が大きい）。
        this.collapseSearchResults();
      });
      this.searchResults.appendChild(item);
    });

    if (allMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-item';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = '該当する部屋が見つかりませんでした。';
      this.searchResults.appendChild(empty);
    }
    this.searchResults.style.display = 'block';
  }

  exportJSON() {
    const jsonStr = JSON.stringify(this.data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'b3_floors_customized.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  importJSON(file) {
    if (!this.isEditMode) return;
    const reader = new FileReader();

    reader.onload = (e) => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (err) {
        alert('JSONファイルの解析に失敗しました。ファイル形式が正しいJSONか確認してください。');
        console.error('Failed to parse imported JSON', err);
        return;
      }

      if (!parsed || !Array.isArray(parsed.floors)) {
        alert('このファイルは対応形式ではありません（floors配列が見つかりません）。\n本ツールで保存したJSONファイルを選択してください。');
        return;
      }

      if (!confirm('現在の編集内容を、読み込んだJSONファイルの内容で上書きします。よろしいですか？')) {
        return;
      }

      // 読み込んだデータ（部屋番号・名称・サイズ・位置・属性・結合/追加/削除結果など、
      // これまで編集入力したすべての情報）をアプリの状態として復元する。
      this.data = parsed;
      this.selectedRoomIds.clear();
      this.exitAddRoomMode();

      // 選択中のフロアが読み込んだデータに存在しない場合は先頭のフロアにフォールバック
      const targetFloor = this.data.floors.find(f => f.floor === this.currentFloorNum)
        ? this.currentFloorNum
        : (this.data.floors[0] ? this.data.floors[0].floor : 1);

      this.savePersistedData();
      this.switchToFloor(targetFloor);
      this.handleSearch(this.searchInput.value.trim());
      alert('JSONファイルを読み込みました。編集内容を復元しました。');
    };

    reader.onerror = () => {
      alert('ファイルの読み込み中にエラーが発生しました。');
      console.error('FileReader error while importing JSON');
    };

    reader.readAsText(file, 'utf-8');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new FloorplanApp();
});
