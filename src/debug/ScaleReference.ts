import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 大きさの目安（開発用）：身長 1.8m のブロック人形。キャラクターではない（キャラクターは A3）。
 * 寸法は設計書のキャラクター（体型A）の比率に合わせる。1回の描画でまとめて表示する（InstancedMesh）。
 */
export const SCALE_REFERENCE_HEIGHT = 1.8;

function box(w: number, h: number, d: number, x: number, yBottom: number, z = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, yBottom + h / 2, z);
  return g;
}

export function createScaleReferenceGeometry(): BufferGeometry {
  const parts = [
    box(0.17, 0.09, 0.28, -0.11, 0, 0.05), // 足
    box(0.17, 0.09, 0.28, 0.11, 0, 0.05),
    box(0.16, 0.38, 0.17, -0.11, 0.09), // 下腿
    box(0.16, 0.38, 0.17, 0.11, 0.09),
    box(0.19, 0.4, 0.19, -0.11, 0.47), // 太もも
    box(0.19, 0.4, 0.19, 0.11, 0.47),
    box(0.42, 0.18, 0.24, 0, 0.87), // 腰
    box(0.5, 0.36, 0.26, 0, 1.05), // 胸
    box(0.15, 0.57, 0.15, -0.33, 0.84), // 腕
    box(0.15, 0.57, 0.15, 0.33, 0.84),
    box(0.12, 0.08, 0.12, 0, 1.41), // 首
    box(0.36, 0.31, 0.34, 0, 1.49), // 頭（上端 1.80）
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('大きさの目安の形状を結合できませんでした');
  return merged;
}

/** 置く位置：中央の紋章の手前、半径10の目安の円、境界の内側（キャラクターの当たり判定の半径0.35を考慮） */
export const SCALE_REFERENCE_POSITIONS: readonly [number, number, number][] = [
  [0, 0, 2.2],
  [-7.07, 0, 7.07],
  [0, 0, 14.4],
];

export function createScaleReference(color: string): InstancedMesh {
  const geometry = createScaleReferenceGeometry();
  const material = new MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 });
  material.name = 'ScaleReference';
  const mesh = new InstancedMesh(geometry, material, SCALE_REFERENCE_POSITIONS.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3(1, 1, 1);
  // 正面の視点（+Z 側）から体の正面が見えるよう、すべて +Z を向ける
  q.identity();
  SCALE_REFERENCE_POSITIONS.forEach(([x, y, z], i) => {
    mesh.setMatrixAt(i, m.compose(new Vector3(x, y, z), q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'ScaleReference';
  return mesh;
}
