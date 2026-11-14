import {
  BufferAttribute,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  type BufferGeometry,
} from 'three';
import { createRandom } from '../../../core/random';
import { COLOSSEUM } from './layout';
import { PALETTE } from './palette';

/**
 * 戦闘エリアの床（模様は floorMaterial.ts）、台座の側面、外の地面。
 * 外周の低い壁・ブロンズの縁取り・段差は buildRim.ts、柱は buildPillars.ts。
 */

/** 高さに応じて下ほど暗くする頂点カラー（簡易的な陰影） */
export function applyHeightShade(geometry: BufferGeometry, bottomY: number, topY: number, bottom = 0.55, top = 1): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(Math.max((pos.getY(i) - bottomY) / (topY - bottomY), 0), 1);
    const v = bottom + (top - bottom) * t;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

/** 上から見た角度（+Z を 0、+X を 90° とする。0〜2π） */
export function angleOf(x: number, z: number): number {
  const a = Math.atan2(x, z);
  return a < 0 ? a + Math.PI * 2 : a;
}

/**
 * 石のブロックごとに明るさを変える（頂点カラーに掛け合わせる）。
 * geometry はインデックスなし（三角形ごとに頂点を持つ）であること。三角形の重心から blockOf でブロックの番号を決める。
 */
export function applyBlockShade(
  geometry: BufferGeometry,
  blockOf: (x: number, y: number, z: number) => number,
  seed: number,
  min = 0.84,
  max = 1,
): void {
  if (geometry.index) throw new Error('applyBlockShade: インデックスなしのジオメトリが必要です');
  const pos = geometry.getAttribute('position');
  let color = geometry.getAttribute('color');
  if (!color) {
    color = new BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
    geometry.setAttribute('color', color);
  }
  const shadeOf = new Map<number, number>();
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
    const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const block = blockOf(cx, cy, cz);
    let v = shadeOf.get(block);
    if (v === undefined) {
      v = min + (max - min) * createRandom((seed + block * 7919) >>> 0)();
      shadeOf.set(block, v);
    }
    for (let k = t; k < t + 3; k++) {
      color.setXYZ(k, color.getX(k) * v, color.getY(k) * v, color.getZ(k) * v);
    }
  }
  color.needsUpdate = true;
}

export interface ArenaMeshes {
  floor: Mesh;
  platformSide: Mesh;
  outerGround: Mesh;
}

export function buildArena(floorMaterial: MeshStandardMaterial): ArenaMeshes {
  const C = COLOSSEUM;

  // 床：細かい分割は不要（模様はシェーダーで描く）。外周の円をなめらかにするため円周方向は細かく
  const floorGeo = new CircleGeometry(C.arenaRadius, 192);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new Mesh(floorGeo, floorMaterial);
  floor.name = 'ArenaFloor';
  floor.receiveShadow = true;

  // 台座の側面（上面 0、下面 -platformHeight。下へ少し広がる）。
  // 外周の段差（-terraceDrop）より上が見える。石のブロック（約1.2m、96個）ごとに明るさを変える
  const SIDE_BLOCKS = 96;
  const sideGeo = new CylinderGeometry(C.arenaRadius, C.arenaRadius + 0.08, C.platformHeight, SIDE_BLOCKS * 2, 1, true).toNonIndexed();
  sideGeo.translate(0, -C.platformHeight / 2, 0);
  applyHeightShade(sideGeo, -C.terraceDrop, 0, 0.7, 1);
  applyBlockShade(sideGeo, (x, _y, z) => Math.floor((angleOf(x, z) / (Math.PI * 2)) * SIDE_BLOCKS), 31, 0.86, 1);
  const sideMat = new MeshStandardMaterial({ color: PALETTE.platformSide, roughness: 0.9, vertexColors: true });
  sideMat.name = 'PlatformSide';
  const platformSide = new Mesh(sideGeo, sideMat);
  platformSide.name = 'PlatformSide';
  platformSide.receiveShadow = true;

  // 外の地面（台座の外側。台座の下に面を作らないよう、輪の形にする）
  const groundGeo = new RingGeometry(C.arenaRadius + 0.02, 400, 192, 1);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, -C.platformHeight, 0);
  const groundMat = new MeshStandardMaterial({ color: new Color(PALETTE.outerGround), roughness: 0.95 });
  groundMat.name = 'OuterGround';
  const outerGround = new Mesh(groundGeo, groundMat);
  outerGround.name = 'OuterGround';
  // 外の地面は影の範囲（半径21）の外まで広がるため、影を受けない（範囲の端が線として見えるのを防ぐ）
  outerGround.receiveShadow = false;

  return { floor, platformSide, outerGround };
}
