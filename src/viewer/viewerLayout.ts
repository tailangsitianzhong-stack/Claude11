import { Vector3 } from 'three';
import { fitDistance } from '../debug/DevCamera';

/**
 * ビューアー（A4）の配置とカメラの計算（画面に依存しない部分。テスト対象）。DESIGN_DECISIONS 10章。
 */

/** 表示するキャラクター：体型A だけ・体型B だけ・2体の比較 */
export const VIEWER_SELECTIONS = ['A', 'B', 'AB'] as const;
export type ViewerSelection = (typeof VIEWER_SELECTIONS)[number];

/** 視点：正面・側面・斜め・上から */
export const VIEWER_VIEWS = ['front', 'side', 'oblique', 'top'] as const;
export type ViewerView = (typeof VIEWER_VIEWS)[number];

export const VIEWER_VIEW_LABELS: Readonly<Record<ViewerView, string>> = {
  front: '正面',
  side: '側面',
  oblique: '斜め',
  top: '上から',
};

/** 2体の比較のときの左右の間隔（中心から ±m）。キャラクターは正面（+Z）を向く */
export const PAIR_HALF_SPACING = 0.75;

/** 表示するキャラクターの x 位置（表示しないものは null） */
export function characterPositions(sel: ViewerSelection): { A: number | null; B: number | null } {
  if (sel === 'A') return { A: 0, B: null };
  if (sel === 'B') return { A: null, B: 0 };
  return { A: -PAIR_HALF_SPACING, B: PAIR_HALF_SPACING };
}

/**
 * 画面に収める範囲（注視点と、包む球の半径）。全高 1.80m の体＋少しの余白。
 * 極端な姿勢（9-5。腕を頭の上へ 170°、脚を前へ 90°。高さ約 2.1m・前へ約 0.9m）を表示しているときだけ、
 * 体の全体が収まるよう、1体の表示のときだけ注視点を上げて半径を広げる（A4 CP2）。それ以外は通常の範囲のまま。
 */
export function framing(sel: ViewerSelection, extremePose = false): { center: Vector3; radius: number } {
  // 2体の比較の範囲（半径 1.55m）には極端な姿勢も収まるため、広げるのは1体の表示だけ
  if (extremePose && sel !== 'AB') return { center: new Vector3(0, 1.1, 0.2), radius: 1.3 };
  return { center: new Vector3(0, 0.9, 0), radius: sel === 'AB' ? 1.55 : 1.05 };
}

/** 視点ごとのカメラの位置（注視点からの向き）。正面は +Z 側から少し見下ろす */
export function cameraPosition(view: ViewerView, center: Vector3, distance: number): Vector3 {
  const dir = new Vector3();
  switch (view) {
    case 'front':
      dir.set(0, Math.sin((5 * Math.PI) / 180), Math.cos((5 * Math.PI) / 180));
      break;
    case 'side':
      // 体の左側（+X）から
      dir.set(Math.cos((5 * Math.PI) / 180), Math.sin((5 * Math.PI) / 180), 0);
      break;
    case 'oblique':
      dir.set(1, 0.6, 1).normalize();
      break;
    case 'top':
      // 真上から（画面の上が奥 = -Z）。真上ちょうどはカメラの上方向が決まらないため、わずかに手前へずらす
      dir.set(0, 1, 0.001).normalize();
      break;
  }
  return dir.multiplyScalar(distance).add(center);
}

/** 包む球が画面に収まる距離（縦横の狭い方の視野角で決まる） */
export function viewDistance(radius: number, vfovDeg: number, aspect: number): number {
  return fitDistance(radius, vfovDeg, aspect);
}
