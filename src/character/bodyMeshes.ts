import { Mesh, type Bone, type BufferGeometry, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { computeLayout, type BodyProfile } from './bodyProfile';
import type { JointName } from './skeleton';

/**
 * 体の部位の形（A3 CP1）。部位ごとに独立したメッシュを関節（Bone）の子に付ける。
 *
 * - 形：角を丸めた箱（体 0.025m、頭 0.05m）を、上下で太さを変えて（先細り）作る。
 * - 継ぎ目：子の部位の端を、関節の反対側（親の側）へ「部位の半径ぶん」はみ出させて重ねる（9-2）。
 * - 「提案値」は設計案に数値がない値（DESIGN_DECISIONS 9-4）。
 */

/** 丸めの分割数 */
const BEVEL_SEGMENTS = 2;

interface BoxSpec {
  w: number;
  d: number;
  /** 関節の座標での下端・上端 */
  y0: number;
  y1: number;
  /** 奥行の中心のずれ（足のつま先など） */
  z?: number;
  x?: number;
  bevel: number;
  /** 下端での幅・奥行の比率（上端を 1 とする） */
  bottomScaleX?: number;
  bottomScaleZ?: number;
}

/** 角を丸めた箱を、上下の太さを変えて作る */
export function taperedBox(s: BoxSpec): BufferGeometry {
  const h = s.y1 - s.y0;
  const bevel = Math.min(s.bevel, s.w / 2 - 1e-3, h / 2 - 1e-3, s.d / 2 - 1e-3);
  const g = new RoundedBoxGeometry(s.w, h, s.d, BEVEL_SEGMENTS, bevel);
  const sx = s.bottomScaleX ?? 1;
  const sz = s.bottomScaleZ ?? 1;
  if (sx !== 1 || sz !== 1) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + h / 2) / h; // 0 = 下端、1 = 上端
      pos.setX(i, pos.getX(i) * (sx + (1 - sx) * t));
      pos.setZ(i, pos.getZ(i) * (sz + (1 - sz) * t));
    }
  }
  g.translate(s.x ?? 0, (s.y0 + s.y1) / 2, s.z ?? 0);
  g.computeVertexNormals();
  return g;
}

/** 足：かかと〜つま先の箱。つま先側は上面を斜めに削り（面取り）、幅を少し細くする（提案値：下げ 0.035m、幅 ×0.85） */
function footGeometry(p: BodyProfile, top: number): BufferGeometry {
  const len = p.heel + p.toe;
  const zc = (p.toe - p.heel) / 2;
  const g = taperedBox({ w: p.foot.w, d: len, y0: -p.foot.h, y1: top, z: zc, bevel: p.bevelBody });
  const pos = g.getAttribute('position');
  const toeStart = zc; // 足の中央から先をつま先として削る
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z <= toeStart) continue;
    const t = Math.min((z - toeStart) / (p.toe - zc), 1);
    pos.setX(i, pos.getX(i) * (1 - 0.15 * t));
    // 上半分だけを下げる（上端ほど大きく、最大 0.035m）
    const y = pos.getY(i);
    const u = (y + p.foot.h / 2) / (top + p.foot.h / 2);
    if (u > 0) pos.setY(i, y - 0.035 * t * u);
  }
  g.computeVertexNormals();
  return g;
}

export interface PartMesh {
  joint: JointName;
  name: string;
  geometry: BufferGeometry;
}

/** 体の各部位の形（関節の座標で） */
export function createBodyParts(p: BodyProfile): PartMesh[] {
  const L = computeLayout(p);
  const b = p.bevelBody;
  const parts: PartMesh[] = [];
  const add = (joint: JointName, name: string, geometry: BufferGeometry) => parts.push({ joint, name, geometry });

  // 腰（hips の関節は腰の部位の中心）
  const waistHalf = p.waist.h / 2;
  add('hips', 'waist', taperedBox({ w: p.waist.w, d: p.waist.d, y0: -waistHalf, y1: waistHalf, bevel: b }));

  // 胸（chest の関節は胸の下端から 0.10m 上）：上が広い台形。下端は腰へ 0.04m 重ねる（提案値。胴を曲げたときのすき間防止）
  const chestJointY = L.chestBottomY + 0.1;
  add(
    'chest',
    'chest',
    taperedBox({
      w: p.chest.w,
      d: p.chest.d,
      y0: L.chestBottomY - chestJointY - 0.04,
      y1: L.chestTopY - chestJointY,
      bevel: b,
      bottomScaleX: p.chestBottomWidth / p.chest.w,
    }),
  );

  // 首：胸と頭の両方に食い込ませる（胸へ 0.02m、頭へ 0.03m。提案値）
  add('neck', 'neck', taperedBox({ w: p.neck.w, d: p.neck.d, y0: -0.02, y1: L.headBottomY - L.chestTopY + 0.03, bevel: b }));

  // 頭：角を大きく丸める
  add('head', 'head', taperedBox({ w: p.head.w, d: p.head.d, y0: 0, y1: p.head.h, bevel: p.bevelHead }));

  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    // 肩のブロック：上腕の上に少し大きいブロックを重ねる（提案値：0.18×0.13×0.18、関節の高さを中心より少し下に）
    add(`shoulder_${side}`, `shoulderBlock_${side}`, taperedBox({ w: 0.18, d: 0.18, y0: -0.08, y1: 0.05, bevel: b }));
    // 上腕：上が太い。肩の関節の上へ半径ぶん重ねる
    const ua = p.upperArm;
    add(
      `shoulder_${side}`,
      `upperArm_${side}`,
      taperedBox({ w: ua.w, d: ua.d, y0: -ua.h, y1: ua.w / 2, bevel: b, bottomScaleX: p.taper.upperArm, bottomScaleZ: p.taper.upperArm }),
    );
    // 前腕：肘の上へ半径ぶん重ねる
    const fa = p.forearm;
    add(
      `elbow_${side}`,
      `forearm_${side}`,
      taperedBox({ w: fa.w, d: fa.d, y0: -fa.h, y1: fa.w / 2, bevel: b, bottomScaleX: p.taper.forearm, bottomScaleZ: p.taper.forearm }),
    );
    // 手：握り拳のブロック（手首の上へ 0.03m 重ねる。提案値）と、親指の小さなブロック（提案値：0.04×0.06×0.05、内側の前寄り）
    const hd = p.hand;
    add(`wrist_${side}`, `hand_${side}`, taperedBox({ w: hd.w, d: hd.d, y0: -hd.h, y1: 0.03, bevel: b }));
    add(
      `wrist_${side}`,
      `thumb_${side}`,
      taperedBox({ w: 0.04, d: 0.05, y0: -0.085, y1: -0.025, x: -sx * (hd.w / 2 - 0.005), z: hd.d / 2 - 0.02, bevel: 0.012 }),
    );
    // 太もも：上が太い。股関節の上へ半径ぶん重ねる
    const th = p.thigh;
    add(
      `hip_${side}`,
      `thigh_${side}`,
      taperedBox({ w: th.w, d: th.d, y0: -th.h, y1: th.w / 2, bevel: b, bottomScaleX: p.taper.thigh, bottomScaleZ: p.taper.thigh }),
    );
    // 下腿：膝の上へ半径ぶん重ねる。膝の前側に小さな膨らみ（提案値：0.11×0.10×0.05、前へ 0.06m）
    const sh = p.shin;
    add(
      `knee_${side}`,
      `shin_${side}`,
      taperedBox({ w: sh.w, d: sh.d, y0: -sh.h, y1: sh.d / 2, bevel: b, bottomScaleX: p.taper.shin, bottomScaleZ: p.taper.shin }),
    );
    add(`knee_${side}`, `kneeCap_${side}`, taperedBox({ w: 0.11, d: 0.05, y0: -0.07, y1: 0.03, z: sh.d / 2 - 0.02, bevel: 0.015 }));
    // 足：足首の関節は足の後ろから 1/3。足首の上へ 0.02m 重ねる（提案値）
    add(`ankle_${side}`, `foot_${side}`, footGeometry(p, 0.02));
  }
  return parts;
}

/** 部位のメッシュを関節に付ける */
export function attachBodyMeshes(bones: Record<JointName, Bone>, parts: PartMesh[], material: Material): Mesh[] {
  return parts.map((part) => {
    const mesh = new Mesh(part.geometry, material);
    mesh.name = part.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bones[part.joint].add(mesh);
    return mesh;
  });
}
