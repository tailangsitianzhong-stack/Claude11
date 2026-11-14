import { BufferAttribute, LatheGeometry, Mesh, MeshStandardMaterial, Vector2, type BufferGeometry } from 'three';
import { angleOf, applyBlockShade } from './buildArena';
import { COLOSSEUM, STANDS_ROW_DEPTH, STANDS_TOP_Y } from './layout';
import { PALETTE } from './palette';

/**
 * 観客席（A2-3）：最前列の手すり壁（土台）と14段の段々の席、最上段の奥の回廊の床（外壁の内側まで）。
 *
 * 断面（台座の中心からの距離 r と高さ y。床面 y=0、外の地面 y=-0.5）：
 *   手すり壁   r 24.0、y -0.5 〜 2.0（外の地面から 2.5m。戦闘エリアの側からは見上げる高さ）
 *   最前列の通路 r 24.0 〜 24.6、y 2.0
 *   段々の席   r 24.6 〜 36.0、14段（1段 奥行き約 0.81m・高さ 0.33m）、最上段 y 6.62
 *   回廊の床   r 36.0 〜 37.0（外壁の内側の面）、y 6.62
 *
 * 円周は外壁のアーチの区画（36、10°ごと）にそろえた36の平らな面にする（外壁の平らな区画とすき間なく接する）。
 * 太陽の影の範囲（半径21）の外なので、影は落とさず受けもしない。陰影は頂点の色で付ける。
 */

/** 円周方向の面の数と開始角（外壁の区画の境目＝区画の中心から ±5° にそろえる） */
const FACETS = COLOSSEUM.archBayCount;
const PHI_START = Math.PI / FACETS;

/** 断面の点（外側の回廊から内側の手すり壁へ、上から下へたどる：各面の表が観客席の上・戦闘エリアの側を向く） */
export function standsProfile(): [number, number][] {
  const C = COLOSSEUM;
  const ground = -C.platformHeight;
  const pts: [number, number][] = [[C.outerWallInnerRadius, STANDS_TOP_Y]];
  for (let i = C.standsRowCount; i >= 1; i--) {
    const rFront = C.standsInnerRadius + C.standsPodiumLedge + STANDS_ROW_DEPTH * (i - 1);
    const yTop = C.standsPodiumHeight + C.standsRowRise * i;
    pts.push([rFront, yTop]); // 段の踏み面（奥から手前へ）
    pts.push([rFront, yTop - C.standsRowRise]); // 段の蹴上げ（上から下へ）
  }
  pts.push([C.standsInnerRadius, C.standsPodiumHeight]); // 最前列の通路
  pts.push([C.standsInnerRadius, ground]); // 手すり壁の面
  return pts;
}

export function createStandsGeometry(): BufferGeometry {
  const C = COLOSSEUM;
  const geo = new LatheGeometry(
    standsProfile().map(([r, y]) => new Vector2(r, y)),
    FACETS,
    PHI_START,
  ).toNonIndexed();
  geo.computeVertexNormals(); // インデックスなし：三角形ごとの法線（段の角をはっきりさせる）

  // 頂点の色：踏み面は明るく、蹴上げ・手すり壁は暗く。下の段ほど少し暗い（上の段ほど光を受ける）
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const up = nrm.getY(i);
    const t = Math.min(Math.max((pos.getY(i) + C.platformHeight) / (STANDS_TOP_Y + C.platformHeight), 0), 1);
    const base = up > 0.5 ? 1 : 0.84;
    const v = base * (0.82 + 0.18 * t);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  // 区画ごとにわずかに色を変える（石材の違い。36区画）
  applyBlockShade(
    geo,
    (x, _y, z) => Math.floor(((angleOf(x, z) - PHI_START + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / FACETS)),
    83,
    0.9,
    1,
  );
  return geo;
}

export function buildStands(): Mesh {
  const mat = new MeshStandardMaterial({ color: PALETTE.stands, roughness: 0.92, vertexColors: true });
  mat.name = 'Stands';
  const stands = new Mesh(createStandsGeometry(), mat);
  stands.name = 'Stands';
  stands.castShadow = false;
  stands.receiveShadow = false;
  return stands;
}
