import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyHeightShade } from './buildArena';
import { brazierPositions, COLOSSEUM } from './layout';
import { MATERIAL, PALETTE } from './palette';

/**
 * かがり火（A2-2）：6基。点光源は使わず、加算合成の炎と「灯り」（足元の光だまり・炭の光）で表す。
 *
 * 描画は6基まとめて4回（InstancedMesh）：石の台・ブロンズの火皿・炎・光（炭と足元の光だまり）。
 * 揺らぎはシェーダーの中で時間から計算する（CPU 側の処理は毎フレーム時間の uniform を1つ進めるだけ）。
 * 炎と光は同じ揺らぎの式を使うので、炎が強いときは灯りも明るくなる。
 *
 * 1基の形（高さは段差の上面から）：
 *   台石     0     〜 0.14  幅 0.62
 *   柱       0.14  〜 0.92  直径 0.40 → 0.30（上ほど細い）
 *   受け     0.92  〜 0.98  直径 0.48
 *   火皿     0.98  〜 1.30  口の直径 0.96（ブロンズ）
 *   炭       1.25           直径 0.84（光る円盤）
 *   炎       1.20  〜 2.20  幅 0.80（外側）／ 0.44（芯）、常にカメラの方を向く板
 *            ＋ 真上から見たとき用の水平の炎（1.28、直径 0.80。真上に近い視点でだけ現れる）
 *   光だまり 段差の上        直径 3.8
 */
export const BRAZIER_PARTS = {
  plinth: { height: 0.14, width: 0.62 },
  column: { height: 0.78, bottomDiameter: 0.4, topDiameter: 0.3 },
  collar: { height: 0.06, diameter: 0.48 },
  bowl: { height: 0.32, rimDiameter: 0.96 },
  coal: { y: 1.25, diameter: 0.84 },
  flame: { base: 1.2, height: 1.0, width: 0.8, coreHeight: 0.62, coreWidth: 0.44, topY: 0.08, topDiameter: 0.8 },
  /** 段差の外周（半径20）からはみ出さない大きさ */
  pool: { diameter: 3.8 },
} as const;

/**
 * 画質ごとの演出（高：細かい揺らぎ（ノイズ2段）・光だまり／中：揺らぎ1段・光だまり／低：揺らぎ1段・光だまりなし）。
 * 炎の板（6基×2層の小さな板）は負荷が小さいのでどの画質でも描く。広い面積を加算で塗る足元の光だまりが最も重いので、低画質で省く。
 */
export type FireDetail = 'high' | 'medium' | 'low';

const SEGMENTS = 20;
/** 光の円盤の分割数（三角形の数 = 分割数） */
const GLOW_SEGMENTS = 32;

/** 炎と光で共有する揺らぎ（0.70〜1.0 前後。周期の違う正弦波を重ねて、規則的に見えないようにする） */
const FLICKER_GLSL = /* glsl */ `
float fireFlicker(float t, float p) {
  return 0.83 + 0.08 * sin(t * 7.3 + p) + 0.05 * sin(t * 12.9 + p * 2.3) + 0.04 * sin(t * 23.1 + p * 4.7);
}
`;

/**
 * 真上から見たとき用の水平の炎が現れ始める・完全に現れる、カメラの見下ろしの度合い
 * （炎からカメラへの向きの上下成分。0.6 ≒ 37°、0.9 ≒ 64° 見下ろし）。
 * 正面（約15°）・斜め（約30°）・近景の視点では 0 なので、通常の見た目は変わらない。
 */
export const FLAME_TOP_FADE = { start: 0.6, end: 0.9 } as const;

const FLAME_VERTEX = /* glsl */ `
attribute float aPhase;
attribute float aLayer;
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
varying float vLayer;
varying float vFlicker;
varying float vTopFade;
${FLICKER_GLSL}
void main() {
  // 1基の中心（火皿の上）。炎の板は縦軸のまわりだけ回してカメラへ向ける
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 toCamFull = cameraPosition - center.xyz;
  vec3 toCam = toCamFull;
  toCam.y = 0.0;
  float len = length(toCam);
  vec3 forward = len > 1e-4 ? toCam / len : vec3(0.0, 0.0, 1.0);
  vec3 right = vec3(forward.z, 0.0, -forward.x);
  vFlicker = fireFlicker(uTime, aPhase);
  vUv = uv;
  vPhase = aPhase;
  vLayer = aLayer;
  vTopFade = 0.0;
  vec3 pos;
  if (aLayer > 1.5) {
    // 水平の炎（真上から見たとき用）：見下ろすほど現れる。現れない視点では面積0にして描画の負荷をなくす
    vTopFade = smoothstep(${FLAME_TOP_FADE.start.toFixed(2)}, ${FLAME_TOP_FADE.end.toFixed(2)}, toCamFull.y / max(length(toCamFull), 1e-4));
    pos = center.xyz + (vTopFade > 0.0 ? position : vec3(0.0));
  } else {
    // 炎の高さも少しだけ揺らす（灯りと同じ揺らぎ）
    float h = mix(0.92, 1.06, (vFlicker - 0.7) / 0.3);
    pos = center.xyz + right * position.x + vec3(0.0, position.y * h, 0.0) + forward * (0.02 * aLayer);
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const FLAME_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOctaves;
varying vec2 vUv;
varying float vPhase;
varying float vLayer;
varying float vFlicker;
varying float vTopFade;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 outerColor(float y) { return mix(vec3(1.0, 0.42, 0.07), vec3(0.75, 0.1, 0.02), y) * 1.25; }
vec3 coreColor(float y) { return mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.55, 0.12), y) * 2.3; }

void main() {
  float t = mod(uTime, 1000.0);
  if (vLayer > 1.5) {
    // 水平の炎：中心が芯の色、外へ行くほど縦の炎の上の方の色。縁は揺らぎで炎の舌のように出入りする
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    vec2 q = p * 2.4 + vec2(vPhase * 3.1 + sin(t * 1.3 + vPhase) * 0.6, vPhase * 5.3 - t * 1.9);
    float n = vnoise(q);
    if (uOctaves > 1.5) n = n * 0.65 + vnoise(q * 2.3 + 7.1) * 0.35;
    float edge = 0.55 + 0.4 * n;
    float m = 1.0 - smoothstep(edge * 0.45, edge, r);
    float k = smoothstep(0.0, 0.85, r / max(edge, 1e-3));
    vec3 col = mix(coreColor(0.2), outerColor(0.6), k);
    gl_FragColor = vec4(col * m * vFlicker * vTopFade, 1.0);
    return;
  }
  float y = vUv.y;
  float x = vUv.x * 2.0 - 1.0;
  // 上へ流れる揺らぎ（芯は速く細かく）
  vec2 q = vec2(x * 1.4 + vPhase * 3.1, y * 2.1 - t * (2.2 + vLayer * 0.8) + vPhase * 5.3);
  float n = vnoise(q);
  if (uOctaves > 1.5) n = n * 0.65 + vnoise(q * 2.3 + 7.1) * 0.35;
  // 上へ行くほど横に揺れ、細くなる（しずく形）
  float xs = x + (n - 0.5) * 0.7 * y;
  float width = mix(0.95, 0.06, pow(y, 0.85));
  float body = 1.0 - smoothstep(width * 0.45, width, abs(xs));
  float top = 1.0 - smoothstep(0.45, 1.0, y + (n - 0.5) * 0.45);
  float bottom = smoothstep(0.0, 0.14, y);
  float m = body * top * bottom;
  vec3 col = mix(outerColor(y), coreColor(y), vLayer);
  // 加算合成（明るい部分は高画質の Bloom でにじむ）
  gl_FragColor = vec4(col * m * vFlicker, 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
attribute float aPhase;
attribute float aStrength;
uniform float uTime;
varying vec2 vUv;
varying float vStrength;
varying float vFlicker;
${FLICKER_GLSL}
void main() {
  vUv = uv;
  vStrength = aStrength;
  vFlicker = fireFlicker(uTime, aPhase);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vStrength;
varying float vFlicker;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  vec3 col;
  if (vStrength > 1.0) {
    // 炭：中心ほど黄色く、縁は赤く暗い
    float a = 1.0 - smoothstep(0.75, 1.0, d);
    col = mix(vec3(1.0, 0.62, 0.2), vec3(0.6, 0.08, 0.01), d) * vStrength * a;
  } else {
    // 足元の光だまり：なめらかに消える
    float a = 1.0 - d;
    col = vec3(1.0, 0.5, 0.18) * vStrength * a * a * a;
  }
  gl_FragColor = vec4(col * vFlicker, 1.0);
}
`;

function cylinder(rTop: number, rBottom: number, height: number, yBottom: number): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, height, SEGMENTS, 1, false);
  g.translate(0, yBottom + height / 2, 0);
  return g;
}

function mergeOrThrow(parts: BufferGeometry[], what: string): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error(`かがり火の形状（${what}）を結合できませんでした`);
  return merged;
}

/** 石の台（台石・柱・受け）。y=0 が段差の上面 */
export function createBrazierStandGeometry(): BufferGeometry {
  const P = BRAZIER_PARTS;
  const plinth = new BoxGeometry(P.plinth.width, P.plinth.height, P.plinth.width);
  plinth.translate(0, P.plinth.height / 2, 0);
  const colBottom = P.plinth.height;
  const collarBottom = colBottom + P.column.height;
  const geo = mergeOrThrow(
    [
      plinth,
      cylinder(P.column.topDiameter / 2, P.column.bottomDiameter / 2, P.column.height, colBottom),
      cylinder(P.collar.diameter / 2, P.collar.diameter / 2, P.collar.height, collarBottom),
    ],
    '石の台',
  );
  applyHeightShade(geo, 0, collarBottom + P.collar.height, 0.75, 1);
  return geo;
}

/** ブロンズの火皿（外側を上へ → 口の縁 → 内側を下へ） */
export function createBrazierBowlGeometry(): BufferGeometry {
  const P = BRAZIER_PARTS;
  const y0 = P.plinth.height + P.column.height + P.collar.height;
  const h = P.bowl.height;
  const r = P.bowl.rimDiameter / 2;
  const profile: [number, number][] = [
    [0.001, y0],
    [0.16, y0],
    [0.3, y0 + h * 0.35],
    [r - 0.04, y0 + h * 0.85],
    [r, y0 + h],
    [r - 0.05, y0 + h],
    [r - 0.08, y0 + h * 0.8],
  ];
  return new LatheGeometry(
    profile.map(([pr, py]) => new Vector2(pr, py)),
    SEGMENTS * 2,
  );
}

/** 炎の板（外側の層・芯の層：x は幅、y は高さ、板の下端が y=0）と、真上から見たとき用の水平の板。aLayer で区別する（0・1・2） */
export function createFlameGeometry(): BufferGeometry {
  const F = BRAZIER_PARTS.flame;
  const layer = (w: number, h: number, value: number) => {
    const g = new PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    g.setAttribute('aLayer', new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(value), 1));
    return g;
  };
  // 真上から見たとき用の水平の炎（aLayer = 2）：火皿の口の少し上
  const top = new PlaneGeometry(F.topDiameter, F.topDiameter);
  top.rotateX(-Math.PI / 2);
  top.translate(0, F.topY, 0);
  top.setAttribute('aLayer', new BufferAttribute(new Float32Array(top.getAttribute('position').count).fill(2), 1));
  return mergeOrThrow([layer(F.width, F.height, 0), layer(F.coreWidth, F.coreHeight, 1), top], '炎');
}

/** 光の円盤（炭・足元の光だまり）。aStrength が 1 を超えるものは炭として描く */
export function createGlowGeometry(): BufferGeometry {
  const P = BRAZIER_PARTS;
  const disc = (diameter: number, y: number, strength: number) => {
    const g = new CircleGeometry(diameter / 2, GLOW_SEGMENTS);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    g.setAttribute('aStrength', new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(strength), 1));
    return g;
  };
  // 炭を先頭にする：低画質では炭だけを描く（drawRange）
  return mergeOrThrow([disc(P.coal.diameter, P.coal.y, 1.6), disc(P.pool.diameter, 0.015, 0.32)], '光');
}

function additiveMaterial(name: string, vertexShader: string, fragmentShader: string, uniforms: Record<string, { value: number }>) {
  const m = new ShaderMaterial({
    name,
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return m;
}

export class Braziers {
  readonly stand: InstancedMesh;
  readonly bowl: InstancedMesh;
  readonly flames: InstancedMesh;
  readonly glow: InstancedMesh;
  /** 影を落とす物（画質で切り替える） */
  readonly shadowCasters: readonly InstancedMesh[];

  private readonly time = { value: 0 };
  private readonly octaves = { value: 2 };
  private readonly coalIndexCount: number;

  constructor() {
    const positions = brazierPositions();
    const n = positions.length;
    const y = -COLOSSEUM.terraceDrop;

    const standMat = new MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.85, vertexColors: true });
    standMat.name = 'BrazierStand';
    this.stand = new InstancedMesh(createBrazierStandGeometry(), standMat, n);
    this.stand.name = 'BrazierStands';

    const bowlMat = new MeshStandardMaterial({
      color: PALETTE.floor.bronze,
      roughness: MATERIAL.bronzeRoughness,
      metalness: MATERIAL.bronzeMetalness,
    });
    bowlMat.name = 'BrazierBowl';
    this.bowl = new InstancedMesh(createBrazierBowlGeometry(), bowlMat, n);
    this.bowl.name = 'BrazierBowls';

    // 炎・光：基ごとに揺らぎの位相を変える（同時に揺れると不自然なため）
    const phases = new Float32Array(n);
    for (let i = 0; i < n; i++) phases[i] = i * 2.399 + 0.7; // 黄金角で散らす

    const flameGeo = createFlameGeometry();
    flameGeo.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1));
    this.flames = new InstancedMesh(
      flameGeo,
      additiveMaterial('BrazierFlame', FLAME_VERTEX, FLAME_FRAGMENT, { uTime: this.time, uOctaves: this.octaves }),
      n,
    );
    this.flames.name = 'BrazierFlames';

    const glowGeo = createGlowGeometry();
    glowGeo.setAttribute('aPhase', new InstancedBufferAttribute(phases.slice(), 1));
    this.coalIndexCount = GLOW_SEGMENTS * 3; // 先頭の円盤（炭）の頂点インデックスの数
    this.glow = new InstancedMesh(glowGeo, additiveMaterial('BrazierGlow', GLOW_VERTEX, GLOW_FRAGMENT, { uTime: this.time }), n);
    this.glow.name = 'BrazierGlow';

    const m = new Matrix4();
    const flameBase = new Matrix4();
    positions.forEach(([x, z], i) => {
      m.makeTranslation(x, y, z);
      this.stand.setMatrixAt(i, m);
      this.bowl.setMatrixAt(i, m);
      this.glow.setMatrixAt(i, m);
      flameBase.makeTranslation(x, y + BRAZIER_PARTS.flame.base, z);
      this.flames.setMatrixAt(i, flameBase);
    });
    for (const mesh of [this.stand, this.bowl, this.flames, this.glow]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    // 炎の板はカメラの方へ回るので、包む球を幅の半分ぶん広げておく（見切れによる消え防止）
    this.flames.boundingSphere!.radius += BRAZIER_PARTS.flame.width;
    for (const mesh of [this.stand, this.bowl]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.shadowCasters = [this.stand, this.bowl];
  }

  get meshes(): InstancedMesh[] {
    return [this.stand, this.bowl, this.flames, this.glow];
  }

  /** 固定間隔のゲーム処理から呼ぶ。時間の uniform を進めるだけ（揺らぎはシェーダーで計算する） */
  update(dt: number): void {
    // 長時間の実行でも精度が落ちないよう、どの揺らぎの周期とも関係しない十分大きな値で折り返す
    this.time.value = (this.time.value + dt) % 3600;
  }

  applyDetail(detail: FireDetail): void {
    this.octaves.value = detail === 'high' ? 2 : 1;
    // 低画質：光は炭だけを描き、足元の光だまりを省く
    this.glow.geometry.setDrawRange(0, detail === 'low' ? this.coalIndexCount : Infinity);
  }

  /** テスト用：時間の uniform の現在値 */
  get timeValue(): number {
    return this.time.value;
  }
}

/** 画質設定からかがり火の演出の段階を決める（設計書 1-3 の段階に合わせる：Bloom あり＝高、背景の密度を下げた後＝低） */
export function fireDetailFor(s: { bloom: boolean; backgroundDensity: string }): FireDetail {
  if (s.backgroundDensity !== 'full') return 'low';
  return s.bloom ? 'high' : 'medium';
}
