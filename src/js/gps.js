// ==========================================================================
// GPS現在地表示機能
// ==========================================================================
// 平面図(SVG, 単位mm)上の2点と、その実世界のGPS座標(緯度経度)を対応付ける
// ことで、任意のGPS座標を平面図mm座標に変換するための2点相似変換
// （回転＋等方スケール＋平行移動）を計算する。
//
// 基準点には、1F平面図に既に登録されている「東正面入口」「西入口」
// （building_outlineから動的に求まる position_mm）をそのまま使うため、
// 管理者による手動キャリブレーション操作は不要（app.js側で自動設定）。
//
// 全フロアは同一のXY座標系（app.js の STACK_VIEW_TOTAL_WIDTH/HEIGHT基準）
// を共有しているため、1Fで求めた変換をそのまま全フロアで使い、現在地の
// XY位置を平面図上に表示できる（ただし高度方向の情報は無いため、
// 実際に今どの階にいるかはユーザー自身の判断に委ねる）。
// ==========================================================================

const EARTH_RADIUS_M = 6378137; // WGS84 赤道半径。数十〜数百m程度の近距離換算には十分な精度。

/**
 * 緯度経度を、基準点(refLat, refLng)まわりの局所平面座標
 * （メートル単位、east=+x, north=+y）に変換する簡易正距円筒図法。
 * 対応点間の距離が数百m程度であれば誤差は無視できるレベル。
 */
export function latLngToLocalMeters(lat, lng, refLat, refLng) {
  const rad = Math.PI / 180;
  const east = (lng - refLng) * rad * EARTH_RADIUS_M * Math.cos(refLat * rad);
  const north = (lat - refLat) * rad * EARTH_RADIUS_M;
  return { e: east, n: north };
}

export function getLatLngCenter(points) {
  if (!points || points.length === 0) return null;
  const sum = points.reduce((acc, p) => {
    acc.lat += p.lat;
    acc.lng += p.lng;
    return acc;
  }, { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

export function getMaxDistanceFromCenterMeters(points, refLat, refLng) {
  if (!points || points.length === 0) return 0;
  const maxDistance = points.reduce((max, point) => {
    const local = latLngToLocalMeters(point.lat, point.lng, refLat, refLng);
    const dist = Math.hypot(local.e, local.n);
    return Math.max(max, dist);
  }, 0);
  return maxDistance;
}

export function isLatLngWithinDistance(lat, lng, centerLat, centerLng, radiusMeters) {
  if (radiusMeters == null || radiusMeters <= 0) return false;
  const local = latLngToLocalMeters(lat, lng, centerLat, centerLng);
  return Math.hypot(local.e, local.n) <= radiusMeters;
}

/**
 * 2組の対応点（ローカルメートル座標 ⇔ 平面図mm座標）から、
 * 複素数表現による2点相似変換（回転＋等方スケール＋平行移動）を求める。
 *   mm = a * local + b   （a, b は複素数として扱う。a = aRe + i*aIm）
 * 2点あれば a, b（実質4つの未知数：スケール・回転角・平行移動x/y）は一意に決まる。
 */
function computeSimilarityTransform(local1, local2, mm1, mm2) {
  const dLe = local2.e - local1.e;
  const dLn = local2.n - local1.n;
  const dMx = mm2.x - mm1.x;
  const dMy = mm2.y - mm1.y;
  const denom = dLe * dLe + dLn * dLn;
  if (denom < 1e-9) return null; // 2つの基準点が近すぎて計算不能

  // a = (M2 - M1) / (L2 - L1) の複素数除算
  const aRe = (dMx * dLe + dMy * dLn) / denom;
  const aIm = (dMy * dLe - dMx * dLn) / denom;
  // b = M1 - a * L1
  const bRe = mm1.x - (aRe * local1.e - aIm * local1.n);
  const bIm = mm1.y - (aIm * local1.e + aRe * local1.n);
  return { aRe, aIm, bRe, bIm };
}

function applyTransform(t, local) {
  return {
    x: t.aRe * local.e - t.aIm * local.n + t.bRe,
    y: t.aIm * local.e + t.aRe * local.n + t.bIm
  };
}

/**
 * GPSキャリブレーション（実世界の緯度経度 ⇔ 平面図mm座標の変換）を担当するクラス。
 * 基準点は呼び出し側（app.js）が用意する。当アプリでは1F平面図に
 * 既に登録されている「東正面入口」「西入口」の座標（building_outlineから
 * 動的に求まる position_mm）をそのまま基準点として使うため、
 * 管理者による手動キャリブレーション操作は不要。
 */
export class GPSCalibration {
  constructor() {
    this.transform = null;
    this.mmPerMeter = null;
    this._refLat = 0;
    this._refLng = 0;
  }

  /**
   * 2つの基準点（各 { lat, lng, mmX, mmY }）からGPS→平面図mm変換を計算する。
   * 呼び出すたびに再計算するだけで、永続化は行わない
   * （平面図データの変更にも常に追従させるため）。
   */
  setReferencePoints(pointA, pointB) {
    if (!pointA || !pointB) {
      this.transform = null;
      this.mmPerMeter = null;
      return;
    }
    const refLat = (pointA.lat + pointB.lat) / 2;
    const refLng = (pointA.lng + pointB.lng) / 2;
    const localA = latLngToLocalMeters(pointA.lat, pointA.lng, refLat, refLng);
    const localB = latLngToLocalMeters(pointB.lat, pointB.lng, refLat, refLng);
    this._refLat = refLat;
    this._refLng = refLng;
    this.transform = computeSimilarityTransform(
      localA, localB,
      { x: pointA.mmX, y: pointA.mmY }, { x: pointB.mmX, y: pointB.mmY }
    );
    this.mmPerMeter = this.transform
      ? Math.sqrt(this.transform.aRe ** 2 + this.transform.aIm ** 2)
      : null;
  }

  /** 現在地表示に使える状態（基準点2点から変換が計算できている）かどうか */
  isReady() {
    return !!this.transform;
  }

  /**
   * 指定したGPS座標が、基準点（東正面入口・西入口の中点）からどれだけ
   * 離れているか（メートル）を返す。キャリブレーション未設定ならnullを返す。
   * B3棟から離れた場所での測位（＝別の場所にいる／GPS誤差が大きい）を
   * 検知してキャンセルする用途を想定。
   */
  distanceFromCenterMeters(lat, lng) {
    if (!this.transform) return null;
    const local = latLngToLocalMeters(lat, lng, this._refLat, this._refLng);
    return Math.hypot(local.e, local.n);
  }

  /** GPS座標(緯度,経度) を 平面図mm座標 {x,y} に変換する。キャリブレーション未設定ならnullを返す。 */
  toMm(lat, lng) {
    if (!this.transform) return null;
    const local = latLngToLocalMeters(lat, lng, this._refLat, this._refLng);
    return applyTransform(this.transform, local);
  }
}

/**
 * navigator.geolocation.watchPosition の薄いラッパー。
 * ブラウザ非対応・権限拒否・タイムアウトなどのエラーハンドリングを一箇所にまとめる。
 */
export class GPSWatcher {
  constructor({ onUpdate, onError } = {}) {
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.watchId = null;
  }

  isSupported() {
    return 'geolocation' in navigator;
  }

  start() {
    if (!this.isSupported()) {
      if (this.onError) {
        this.onError({ code: 'unsupported', message: 'この端末・ブラウザは位置情報の取得に対応していません。' });
      }
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (this.onUpdate) {
          this.onUpdate({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy // メートル単位の推定誤差半径
          });
        }
      },
      (err) => {
        if (this.onError) {
          this.onError({ code: 'geo_error', message: this._describeError(err), raw: err });
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  stop() {
    if (this.watchId !== null && this.isSupported()) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  _describeError(err) {
    switch (err.code) {
      case err.PERMISSION_DENIED:
        return '位置情報の利用が許可されていません。ブラウザ／OSの設定で位置情報の許可をご確認ください。';
      case err.POSITION_UNAVAILABLE:
        return '現在地を取得できませんでした。電波状況の良い場所（屋外や窓際など）でお試しください。';
      case err.TIMEOUT:
        return '現在地の取得がタイムアウトしました。もう一度お試しください。';
      default:
        return '現在地の取得中にエラーが発生しました。';
    }
  }
}
