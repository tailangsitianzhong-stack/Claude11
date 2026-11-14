import { MeshBasicMaterial, type Material } from 'three';
import type { CharacterBody } from '../character/CharacterBody';
import type { JointName } from '../character/skeleton';

/**
 * キャラクターの確認用（開発・検証専用。A3 CP3）。一般利用者向けのビューアー・操作は A4 の範囲で、ここでは作らない。
 *
 * - 極端な姿勢：DESIGN_DECISIONS 9-5 の5つの角度を1つの姿勢にまとめ、継ぎ目・輪郭線の破綻を確かめる
 * - シルエット：体を黒一色（光の影響なし）にして、体型A・B の形を比べる
 *
 * main.ts から開発サーバーのときだけ使う（?pose=extreme / ?silhouette=1）。ビューアー（A4）からも使う。
 */

/** 肘・膝 140°、肩 170°、股関節 90°の蹴り上げ、胴 45°のひねり（角度は度、軸と符号は jointLimits.ts） */
export const EXTREME_POSE: Partial<Record<JointName, { x: number; y: number; z: number }>> = {
  spine: { x: 0, y: 45, z: 0 },
  shoulder_L: { x: 0, y: 0, z: 170 },
  shoulder_R: { x: -60, y: 0, z: 0 },
  elbow_R: { x: -140, y: 0, z: 0 },
  hip_L: { x: -90, y: 0, z: 0 },
  hip_R: { x: -20, y: 0, z: 0 },
  knee_R: { x: 140, y: 0, z: 0 },
};

const silhouetteMaterial = new MeshBasicMaterial({ color: 0x000000 });
silhouetteMaterial.name = 'CharacterSilhouette';
const originals = new WeakMap<CharacterBody, Material[]>();

/** シルエット表示の切り替え（輪郭線は消す。元に戻したあとの輪郭線の表示は CharacterBody.applyQuality で戻す） */
export function setSilhouette(body: CharacterBody, on: boolean): void {
  if (on) {
    if (!originals.has(body)) originals.set(body, body.meshes.map((m) => m.material as Material));
    for (const m of body.meshes) m.material = silhouetteMaterial;
    for (const o of body.outlines) o.visible = false;
  } else {
    const mats = originals.get(body);
    if (mats) body.meshes.forEach((m, i) => (m.material = mats[i]!));
    originals.delete(body);
  }
}
