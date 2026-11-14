import {
  BoxGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyHeightShade } from './buildArena';
import { COLOSSEUM, pillarPositions } from './layout';
import { MATERIAL, PALETTE } from './palette';

/**
 * 柱（A2-2）：12本を2つの InstancedMesh（石・ブロンズ）で描く（描画は2回、影の描画も2回）。
 * 横梁は作らない。
 *
 * 1本の形（高さは段差の上面からの値。合計 7.5m）：
 *   台石（四角）     0     〜 0.35   幅 1.40
 *   礎盤（丸）       0.35  〜 0.53   直径 1.28
 *   柱身             0.53  〜 6.95   直径 1.10（指定の直径）
 *   ブロンズの帯     柱身の上端・下端（直径 1.14、高さ 0.10）
 *   柱頭（丸い受け） 6.95  〜 7.20   直径 1.10 → 1.36
 *   頂板（四角）     7.20  〜 7.50   幅 1.50
 */
export const PILLAR_PARTS = {
  plinth: { height: 0.35, width: 1.4 },
  base: { height: 0.18, diameter: 1.28 },
  capital: { height: 0.25, topDiameter: 1.36 },
  abacus: { height: 0.3, width: 1.5 },
  band: { height: 0.1, diameter: 1.14 },
} as const;

const RADIAL_SEGMENTS = 24;

function cylinder(rTop: number, rBottom: number, height: number, yBottom: number): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, height, RADIAL_SEGMENTS, 1, false);
  g.translate(0, yBottom + height / 2, 0);
  return g;
}

function box(width: number, height: number, yBottom: number): BufferGeometry {
  const g = new BoxGeometry(width, height, width);
  g.translate(0, yBottom + height / 2, 0);
  return g;
}

function merge(parts: BufferGeometry[], what: string): BufferGeometry {
  // 円柱と箱は属性（uv・法線）がそろっているのでそのまま結合できる。インデックスの有無もそろっている
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error(`柱の形状（${what}）を結合できませんでした`);
  return merged;
}

/** 1本分の石の部分（台石・礎盤・柱身・柱頭・頂板）。y=0 が足元 */
export function createPillarStoneGeometry(): BufferGeometry {
  const P = PILLAR_PARTS;
  const H = COLOSSEUM.pillarHeight;
  const r = COLOSSEUM.pillarDiameter / 2;
  const shaftBottom = P.plinth.height + P.base.height;
  const capitalBottom = H - P.abacus.height - P.capital.height;
  const geo = merge(
    [
      box(P.plinth.width, P.plinth.height, 0),
      cylinder(P.base.diameter / 2, P.base.diameter / 2, P.base.height, P.plinth.height),
      cylinder(r, r, capitalBottom - shaftBottom, shaftBottom),
      cylinder(P.capital.topDiameter / 2, r, P.capital.height, capitalBottom),
      box(P.abacus.width, P.abacus.height, H - P.abacus.height),
    ],
    '石',
  );
  // 足元ほど少し暗く（地面からの照り返しが少ない部分）
  applyHeightShade(geo, 0, H, 0.72, 1);
  return geo;
}

/** 1本分のブロンズの帯（柱身の下端と上端） */
export function createPillarBandGeometry(): BufferGeometry {
  const P = PILLAR_PARTS;
  const H = COLOSSEUM.pillarHeight;
  const rb = P.band.diameter / 2;
  const shaftBottom = P.plinth.height + P.base.height;
  const capitalBottom = H - P.abacus.height - P.capital.height;
  return merge(
    [cylinder(rb, rb, P.band.height, shaftBottom), cylinder(rb, rb, P.band.height, capitalBottom - P.band.height)],
    'ブロンズの帯',
  );
}

export interface PillarMeshes {
  stone: InstancedMesh;
  bands: InstancedMesh;
}

export function buildPillars(): PillarMeshes {
  const positions = pillarPositions();
  const y = -COLOSSEUM.terraceDrop;

  const stoneMat = new MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.85, vertexColors: true });
  stoneMat.name = 'Pillar';
  const stone = new InstancedMesh(createPillarStoneGeometry(), stoneMat, positions.length);
  stone.name = 'Pillars';

  const bandMat = new MeshStandardMaterial({
    color: PALETTE.floor.bronze,
    roughness: MATERIAL.bronzeRoughness,
    metalness: MATERIAL.bronzeMetalness,
  });
  bandMat.name = 'PillarBands';
  const bands = new InstancedMesh(createPillarBandGeometry(), bandMat, positions.length);
  bands.name = 'PillarBands';

  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  positions.forEach(([x, z], i) => {
    // 四角い台石・頂板の面がアリーナの中心を向くよう、柱ごとに回す
    q.setFromAxisAngle(up, Math.atan2(x, z));
    m.compose(new Vector3(x, y, z), q, s);
    stone.setMatrixAt(i, m);
    bands.setMatrixAt(i, m);
  });
  for (const mesh of [stone, bands]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return { stone, bands };
}
