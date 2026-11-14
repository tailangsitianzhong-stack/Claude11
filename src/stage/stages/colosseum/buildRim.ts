import { CylinderGeometry, LatheGeometry, Mesh, MeshStandardMaterial, RingGeometry, Vector2, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { angleOf, applyBlockShade, applyHeightShade } from './buildArena';
import { COLOSSEUM } from './layout';
import { MATERIAL, PALETTE } from './palette';

/**
 * 外周（A2-2）：台座の端の低い壁、その上のブロンズの縁取り、台座の外側の一段低い段差（柱が並ぶ）。
 *
 * 断面（台座の中心からの距離 r と高さ y。床面 y=0）：
 *   低い壁      r 15.72〜16.0、y 0〜0.54（石）＋ 縁取り y 0.54〜0.60（ブロンズ、内外に 4cm 張り出す）
 *   台座の側面  r 16.0、y 0〜-0.25 が見える（buildArena.ts）
 *   段差        r 16.0〜20.0、y -0.25（上面）、外側の面は y -0.25〜-0.5（外の地面）
 *
 * 壁の石は約1.2m のブロック（84個）で、ブロックごとに平らな面にする（円周方向の分割＝ブロック）。
 */
export const RIM_WALL_BLOCKS = 84;
const TERRACE_BLOCKS = 120;
const TERRACE_COURSES = 3;
const CAP_OVERHANG = 0.04;

export interface RimMeshes {
  wall: Mesh;
  cap: Mesh;
  terrace: Mesh;
}

/** 断面（r, y の点の列）を回転させた面。平らなブロック・はっきりした角にするため、面ごとの法線にする */
function latheFlat(profile: [number, number][], segments: number): BufferGeometry {
  const geo = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  ).toNonIndexed();
  geo.computeVertexNormals(); // インデックスなしなので三角形ごとの法線になる
  return geo;
}

const blockByAngle = (count: number) => (x: number, _y: number, z: number) =>
  Math.floor((angleOf(x, z) / (Math.PI * 2)) * count) % count;

export function buildRim(): RimMeshes {
  const C = COLOSSEUM;
  const rIn = C.rimWallInnerRadius;
  const rOut = C.arenaRadius;
  const stoneTop = C.rimWallHeight - C.rimCapThickness;

  // 低い壁（石）：断面を「外側の面を上へ → 上面を内側へ → 内側の面を下へ」の順にたどると、各面の法線が外向きになる
  const wallGeo = latheFlat(
    [
      [rOut, 0],
      [rOut, stoneTop],
      [rIn, stoneTop],
      [rIn, 0],
    ],
    RIM_WALL_BLOCKS,
  );
  applyHeightShade(wallGeo, 0, stoneTop, 0.78, 1);
  applyBlockShade(wallGeo, blockByAngle(RIM_WALL_BLOCKS), 47, 0.84, 1);
  const wallMat = new MeshStandardMaterial({ color: PALETTE.rimWall, roughness: 0.88, vertexColors: true });
  wallMat.name = 'RimWall';
  const wall = new Mesh(wallGeo, wallMat);
  wall.name = 'RimWall';
  wall.castShadow = true;
  wall.receiveShadow = true;

  // ブロンズの縁取り（壁の上。内外に少し張り出す）
  const capIn = rIn - CAP_OVERHANG;
  const capOut = rOut + CAP_OVERHANG;
  const capGeo = latheFlat(
    [
      [capOut, stoneTop],
      [capOut, C.rimWallHeight],
      [capIn, C.rimWallHeight],
      [capIn, stoneTop],
      [capOut, stoneTop], // 下面（張り出しの裏）
    ],
    RIM_WALL_BLOCKS * 2,
  );
  const capMat = new MeshStandardMaterial({
    color: PALETTE.floor.bronze,
    roughness: MATERIAL.bronzeRoughness,
    metalness: MATERIAL.bronzeMetalness,
  });
  capMat.name = 'RimCap';
  const cap = new Mesh(capGeo, capMat);
  cap.name = 'RimCap';
  cap.castShadow = true;
  cap.receiveShadow = true;

  // 段差：上面（敷石。円周 120 × 半径方向 3 列）と、外側の面
  const terraceY = -C.terraceDrop;
  const topGeo = new RingGeometry(rOut, C.terraceOuterRadius, TERRACE_BLOCKS, TERRACE_COURSES).toNonIndexed();
  topGeo.rotateX(-Math.PI / 2);
  topGeo.translate(0, terraceY, 0);
  const courseWidth = (C.terraceOuterRadius - rOut) / TERRACE_COURSES;
  const edgeGeo = new CylinderGeometry(
    C.terraceOuterRadius,
    C.terraceOuterRadius + 0.03,
    C.platformHeight - C.terraceDrop,
    TERRACE_BLOCKS,
    1,
    true,
  ).toNonIndexed();
  edgeGeo.translate(0, (terraceY - C.platformHeight) / 2, 0);
  for (const g of [topGeo, edgeGeo]) applyHeightShade(g, -C.platformHeight, terraceY, 0.7, 1);
  const terraceGeo = mergeGeometries([topGeo, edgeGeo]);
  topGeo.dispose();
  edgeGeo.dispose();
  if (!terraceGeo) throw new Error('外周の段差の形状を結合できませんでした');
  applyBlockShade(
    terraceGeo,
    (x, y, z) => {
      const along = blockByAngle(TERRACE_BLOCKS)(x, y, z);
      // 列ごとに石の継ぎ目の位置が同じにならないよう、列番号も番号に含める（外側の面は最後の列の扱い）
      const course = Math.min(Math.floor((Math.hypot(x, z) - rOut) / courseWidth), TERRACE_COURSES - 1);
      return course * TERRACE_BLOCKS + along;
    },
    59,
    0.8,
    1,
  );
  const terraceMat = new MeshStandardMaterial({ color: PALETTE.terrace, roughness: 0.92, vertexColors: true });
  terraceMat.name = 'Terrace';
  const terrace = new Mesh(terraceGeo, terraceMat);
  terrace.name = 'Terrace';
  // 段差は影の範囲（半径21）の内側に収まるので、柱・壁の影を受ける
  terrace.receiveShadow = true;

  return { wall, cap, terrace };
}
