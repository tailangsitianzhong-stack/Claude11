import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { StageViewData } from '../stage/StageDefinition';

/**
 * 確認用カメラ（開発専用）。ステージの確認・調整に使う。
 * プレイヤーが使うゲームのカメラ（B3 で実装）とは完全に別物で、入力システム（B1）も使わない。
 *
 * - OrbitControls で自由に回転・ズーム・平行移動できる（マウス・指）
 * - 4つの視点のプリセット：正面の全景・斜めの全景・上空の全景・戦闘エリアの近景
 * - 最大距離は、画面の縦横比と視野角から「ステージ全体（外壁まで）が収まる距離」を計算する
 * - カメラは床・地面より下に入らない（最低の高さ）
 * - これはカメラの移動範囲であり、ステージの衝突やゲーム上の移動範囲（StageGameplayData）とは無関係
 */

export type ViewPreset = 'front' | 'oblique' | 'top' | 'close';
export const VIEW_PRESETS: readonly ViewPreset[] = ['front', 'oblique', 'top', 'close'];
export const VIEW_PRESET_LABELS: Readonly<Record<ViewPreset, string>> = {
  front: '正面の全景',
  oblique: '斜めの全景',
  top: '上空の全景',
  close: '戦闘エリアの近景',
};

/**
 * 半径 radius の球が、縦の視野角 vfovDeg・縦横比 aspect の画面に収まるカメラの距離。
 * 縦・横のうち狭い方の視野角で決まる（縦長のスマホでは横方向が狭い）。
 */
export function fitDistance(radius: number, vfovDeg: number, aspect: number): number {
  const v = (vfovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return radius / Math.sin(Math.min(v, h) / 2);
}

export const DEV_CAMERA_FOV = 45;
export const DEV_CAMERA_MIN_DISTANCE = 1.5;

export class DevCamera {
  readonly camera = new PerspectiveCamera(DEV_CAMERA_FOV, 1, 0.1, 3000);
  readonly controls: OrbitControls;
  private current: ViewPreset | null = null;

  constructor(
    domElement: HTMLElement,
    private readonly view: StageViewData,
  ) {
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = DEV_CAMERA_MIN_DISTANCE;
    this.controls.maxPolarAngle = Math.PI * 0.495; // 注視点より下へ回り込まない
    this.controls.addEventListener('start', () => {
      this.current = null; // 手で動かしたら「プリセットのまま」ではない
    });
    this.applyPreset('oblique');
  }

  get preset(): ViewPreset | null {
    return this.current;
  }

  /** 全景の距離（縦横比に応じて変わる） */
  get overviewDistance(): number {
    return fitDistance(this.view.overviewRadius, this.camera.fov, this.camera.aspect);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // 最大距離：全景が収まる距離に少し余裕を持たせる
    this.controls.maxDistance = this.overviewDistance * 1.25;
    // 縦横比が変わったら、選択中のプリセットを掛け直す（全景がはみ出さないように）
    if (this.current) this.applyPreset(this.current);
  }

  applyPreset(preset: ViewPreset): void {
    const c = this.view.overviewCenter;
    const d = this.overviewDistance;
    const target = new Vector3();
    const pos = new Vector3();
    switch (preset) {
      case 'front': // 正面（+Z）から、やや見下ろす
        target.copy(c);
        pos.set(0, Math.sin((15 * Math.PI) / 180), Math.cos((15 * Math.PI) / 180)).multiplyScalar(d).add(c);
        break;
      case 'oblique': // 斜め上から
        target.copy(c);
        pos.set(1, 0.85, 1).normalize().multiplyScalar(d).add(c);
        break;
      case 'top': // 真上から（画面の上が奥 = -Z）
        target.set(0, 0, 0);
        pos.set(0, d + c.y, 0.001);
        break;
      case 'close': // 戦闘エリアの近景（後のゲームカメラに近い距離と高さ）
        target.set(0, 1.0, 0);
        pos.set(4.5, 3.2, 9.5);
        break;
    }
    this.controls.target.copy(target);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    this.controls.update();
    this.current = preset;
  }

  /** 描画フレームごとに呼ぶ（慣性と最低の高さ） */
  update(): void {
    this.controls.update();
    const minY = this.view.minCameraHeight;
    if (this.controls.target.y < 0) this.controls.target.y = 0;
    if (this.camera.position.y < minY) {
      this.camera.position.y = minY;
      this.camera.lookAt(this.controls.target);
    }
  }

  dispose(): void {
    this.controls.dispose();
  }
}
