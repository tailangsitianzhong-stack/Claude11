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
import { COLOSSEUM } from './layout';
import { PALETTE } from './palette';

/**
 * A2-1 の範囲：戦闘エリアの床（模様は floorMaterial.ts）、台座の側面、外の地面。
 * 外周の段差・低い壁・ブロンズの縁取りは A2-2 で追加する。
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

  // 台座の側面（上面 0、下面 -platformHeight。下へ少し広がる）
  const sideGeo = new CylinderGeometry(C.arenaRadius, C.arenaRadius + 0.08, C.platformHeight, 192, 1, true);
  sideGeo.translate(0, -C.platformHeight / 2, 0);
  applyHeightShade(sideGeo, -C.platformHeight, 0, 0.6, 1);
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
