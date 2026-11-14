import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { createRandom } from '../../../core/random';
import { COLOSSEUM, STANDS_TOP_Y, archBayAngleDeg } from './layout';
import { PALETTE } from './palette';

/**
 * 外壁（A2-3）：36区画（10°ごと）の1区画分の形を InstancedMesh で並べる（描画1回）。
 *
 * 1区画（区画の中心の向きを +Z、円周方向を x とする。内側の面 z≒36.86、外側の面 z≒37.86。高さは床面から）：
 *   内側の面   回廊の床（6.62）〜 上端（12）。アーチの開口（幅 3.4m、付け根 9.22、頂点 10.92）が外まで抜ける
 *   外側の面   外の地面（-0.5）〜 上端（12）。上の層は同じ開口、下の層は浅いアーチのくぼみ（深さ 0.3m、頂点 5.1）
 *   上面       12
 *   蛇腹       外側の面の上下の層の境目（6.62）と上端、内側の面の上端に、12cm 張り出す高さ 28cm の帯
 * 区画の両端の面は隣の区画と接するので作らない。回廊の床より下の内側の面は観客席に隠れるので作らない。
 * 区画は平らな面（36角形）で、観客席・回廊の床（buildStands.ts）の36の面と角がそろう。
 * 太陽の影の範囲（半径21）の外なので、影は落とさず受けもしない。陰影は頂点の色で付ける。
 */

const C = COLOSSEUM;
const HALF_ANGLE = Math.PI / C.archBayCount;
const GROUND_Y = -C.platformHeight;
/** アーチの曲線の分割数（半円） */
const ARCH_SEGMENTS = 16;

type V2 = [number, number];

/** 三角形を集める。表の向き（desired）に合わせて頂点の順番を決める */
class TriangleSink {
  readonly positions: number[] = [];
  readonly colors: number[] = [];

  add(a: Vector3, b: Vector3, c: Vector3, desired: Vector3, shade: number): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const [p, q, r] = n.dot(desired) >= 0 ? [a, b, c] : [a, c, b];
    for (const v of [p, q, r]) {
      this.positions.push(v.x, v.y, v.z);
      this.colors.push(shade, shade, shade);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, desired: Vector3, shade: number): void {
    this.add(a, b, c, desired, shade);
    this.add(a, c, d, desired, shade);
  }
}

/** アーチの半円の点（左から右へ。中心 (0, spring)、半径 r） */
function archPoints(spring: number, r: number, extraAngles: number[] = []): { angle: number; p: V2 }[] {
  const angles = new Set<number>();
  for (let k = 0; k <= ARCH_SEGMENTS; k++) angles.add(Math.PI - (Math.PI * k) / ARCH_SEGMENTS);
  for (const a of extraAngles) angles.add(a);
  return [...angles]
    .sort((x, y) => y - x)
    .map((angle) => ({ angle, p: [r * Math.cos(angle), spring + r * Math.sin(angle)] as V2 }));
}

/**
 * 平らな面（z 一定）：長方形 [x0,x1]×[y0,y1] から、下端から立ち上がるアーチ形（幅 2r、付け根 spring）を抜いた形。
 */
function notchedFace(
  sink: TriangleSink,
  z: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  r: number,
  spring: number,
  normal: Vector3,
  shadeOf: (y: number) => number,
): void {
  const v = (x: number, y: number) => new Vector3(x, y, z);
  const s = (y: number) => shadeOf(y);
  // 左右の脚（付け根より下）
  if (spring > y0) {
    sink.quad(v(x0, y0), v(-r, y0), v(-r, spring), v(x0, spring), normal, s((y0 + spring) / 2));
    sink.quad(v(r, y0), v(x1, y0), v(x1, spring), v(r, spring), normal, s((y0 + spring) / 2));
  }
  // 付け根より上：半円の各点から、中心を通る線を長方形の縁まで伸ばした点との間を帯で埋める（角の点も必ず含める）
  const h = y1 - spring;
  const corners = [Math.atan2(h, x0), Math.atan2(h, x1)];
  const pts = archPoints(spring, r, corners);
  const hit = (angle: number): V2 => {
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    let t = Infinity;
    if (c < -1e-9) t = Math.min(t, x0 / c);
    if (c > 1e-9) t = Math.min(t, x1 / c);
    if (sn > 1e-9) t = Math.min(t, h / sn);
    return [t * c, spring + t * sn];
  };
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const qa = hit(a.angle);
    const qb = hit(b.angle);
    sink.quad(v(...a.p), v(...b.p), v(...qb), v(...qa), normal, s((a.p[1] + qa[1]) / 2));
  }
}

/** 開口の内側の面（両側の脚の面とアーチの下面）を z0〜z1 の間に作る。表は開口の中心線の側 */
function openingSides(sink: TriangleSink, z0: number, z1: number, y0: number, r: number, spring: number, shade: number): void {
  const left = new Vector3(1, 0, 0);
  const right = new Vector3(-1, 0, 0);
  sink.quad(new Vector3(-r, y0, z0), new Vector3(-r, y0, z1), new Vector3(-r, spring, z1), new Vector3(-r, spring, z0), left, shade);
  sink.quad(new Vector3(r, y0, z0), new Vector3(r, y0, z1), new Vector3(r, spring, z1), new Vector3(r, spring, z0), right, shade);
  const pts = archPoints(spring, r);
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const mid = (a.angle + b.angle) / 2;
    const inward = new Vector3(-Math.cos(mid), -Math.sin(mid), 0);
    sink.quad(
      new Vector3(a.p[0], a.p[1], z0),
      new Vector3(b.p[0], b.p[1], z0),
      new Vector3(b.p[0], b.p[1], z1),
      new Vector3(a.p[0], a.p[1], z1),
      inward,
      shade,
    );
  }
}

/** 浅いアーチのくぼみの奥の面（アーチ形をそのまま塞ぐ） */
function archPanel(sink: TriangleSink, z: number, y0: number, r: number, spring: number, normal: Vector3, shade: number): void {
  const v = (x: number, y: number) => new Vector3(x, y, z);
  // 半円の扇の中心（0, spring）と辺を共有するよう、長方形を中心で2つに分ける（T字の継ぎ目によるすき間を防ぐ）
  sink.quad(v(-r, y0), v(0, y0), v(0, spring), v(-r, spring), normal, shade);
  sink.quad(v(0, y0), v(r, y0), v(r, spring), v(0, spring), normal, shade);
  const pts = archPoints(spring, r);
  for (let k = 0; k < pts.length - 1; k++) {
    sink.add(v(0, spring), v(...pts[k]!.p), v(...pts[k + 1]!.p), normal, shade);
  }
}

/**
 * 面から張り出す水平の帯（蛇腹）。上下の層の継ぎ目・上端の角を覆う（頂点がそろわない面どうしの継ぎ目のすき間を隠す）。
 * zFace の面から dir（+1：外へ / -1：内へ）の向きに depth だけ張り出す。幅は区画の角度に合わせて隣の区画とつながる。
 */
function band(sink: TriangleSink, zFace: number, dir: 1 | -1, yCenter: number, height: number, depth: number, shade: number): void {
  const zFront = zFace + dir * depth;
  const t = Math.tan(HALF_ANGLE);
  const xa = Math.abs(zFace) * t;
  const xb = Math.abs(zFront) * t;
  const y0 = yCenter - height / 2;
  const y1 = yCenter + height / 2;
  const facing = new Vector3(0, 0, dir);
  sink.quad(new Vector3(-xb, y0, zFront), new Vector3(xb, y0, zFront), new Vector3(xb, y1, zFront), new Vector3(-xb, y1, zFront), facing, shade);
  sink.quad(new Vector3(-xa, y1, zFace), new Vector3(xa, y1, zFace), new Vector3(xb, y1, zFront), new Vector3(-xb, y1, zFront), new Vector3(0, 1, 0), shade);
  sink.quad(new Vector3(-xa, y0, zFace), new Vector3(xa, y0, zFace), new Vector3(xb, y0, zFront), new Vector3(-xb, y0, zFront), new Vector3(0, -1, 0), shade * 0.8);
}

/** 外壁1区画の形（区画の中心が +Z） */
export function createOuterWallBayGeometry(): BufferGeometry {
  const sink = new TriangleSink();
  const zIn = C.outerWallInnerRadius * Math.cos(HALF_ANGLE);
  const zOut = C.outerWallRadius * Math.cos(HALF_ANGLE);
  const xIn = C.outerWallInnerRadius * Math.sin(HALF_ANGLE);
  const xOut = C.outerWallRadius * Math.sin(HALF_ANGLE);
  const top = C.outerWallHeight;
  const r = C.arcadeOpeningWidth / 2;
  const arcadeSpring = STANDS_TOP_Y + C.arcadeSpringHeight;
  const blindSpring = GROUND_Y + C.blindArchSpringHeight;
  const inward = new Vector3(0, 0, -1);
  const outward = new Vector3(0, 0, 1);
  // 下ほど少し暗く（地面からの照り返しが少ない）
  const shadeOf = (y: number) => 0.78 + 0.22 * Math.min(Math.max((y - GROUND_Y) / (top - GROUND_Y), 0), 1);

  // 内側の面（回廊の床から上）と、外側の面の上の層：同じアーチの開口
  notchedFace(sink, zIn, -xIn, xIn, STANDS_TOP_Y, top, r, arcadeSpring, inward, shadeOf);
  notchedFace(sink, zOut, -xOut, xOut, STANDS_TOP_Y, top, r, arcadeSpring, outward, shadeOf);
  // 開口の内側（脚の面・アーチの下面）と開口の床
  openingSides(sink, zIn, zOut, STANDS_TOP_Y, r, arcadeSpring, 0.74);
  sink.quad(
    new Vector3(-r, STANDS_TOP_Y, zIn),
    new Vector3(r, STANDS_TOP_Y, zIn),
    new Vector3(r, STANDS_TOP_Y, zOut),
    new Vector3(-r, STANDS_TOP_Y, zOut),
    new Vector3(0, 1, 0),
    0.85,
  );
  // 外側の面の下の層：浅いアーチのくぼみ
  notchedFace(sink, zOut, -xOut, xOut, GROUND_Y, STANDS_TOP_Y, r, blindSpring, outward, shadeOf);
  const zRecess = zOut - C.blindArchDepth;
  openingSides(sink, zRecess, zOut, GROUND_Y, r, blindSpring, 0.7);
  archPanel(sink, zRecess, GROUND_Y, r, blindSpring, outward, 0.62);
  // 蛇腹：外側の面の上下の層の境目と上端、内側の面の上端
  const BAND_H = 0.28;
  const BAND_D = 0.12;
  band(sink, zOut, 1, STANDS_TOP_Y, BAND_H, BAND_D, 0.95);
  band(sink, zOut, 1, top - BAND_H / 2, BAND_H, BAND_D, 1);
  band(sink, zIn, -1, top - BAND_H / 2, BAND_H, BAND_D, 1);
  // 上面
  sink.quad(
    new Vector3(-xIn, top, zIn),
    new Vector3(xIn, top, zIn),
    new Vector3(xOut, top, zOut),
    new Vector3(-xOut, top, zOut),
    new Vector3(0, 1, 0),
    1,
  );

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(sink.positions), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(sink.colors), 3));
  geo.computeVertexNormals(); // インデックスなし：三角形ごとの法線
  return geo;
}

export function buildOuterWall(): InstancedMesh {
  const mat = new MeshStandardMaterial({ color: PALETTE.outerWall, roughness: 0.9, vertexColors: true });
  mat.name = 'OuterWall';
  const wall = new InstancedMesh(createOuterWallBayGeometry(), mat, C.archBayCount);
  wall.name = 'OuterWall';
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const zero = new Vector3();
  const rand = createRandom(97);
  const tint = new Color();
  for (let i = 0; i < C.archBayCount; i++) {
    q.setFromAxisAngle(up, (archBayAngleDeg(i) * Math.PI) / 180);
    wall.setMatrixAt(i, m.compose(zero, q, one));
    // 区画ごとにわずかに明るさを変える（石材の違い）
    const v = 0.92 + 0.08 * rand();
    wall.setColorAt(i, tint.setRGB(v, v, v));
  }
  wall.instanceMatrix.needsUpdate = true;
  if (wall.instanceColor) wall.instanceColor.needsUpdate = true;
  wall.computeBoundingSphere();
  wall.castShadow = false;
  wall.receiveShadow = false;
  return wall;
}
