import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import { createRandom } from '../../../core/random';
import { COLOSSEUM } from './layout';
import { PALETTE } from './palette';

/**
 * 遠景（A2-3）：外の地面の続き、丘の連なり（全周）、遠くの街の影絵（太陽と反対側の一部）。
 *
 *   遠くの地面  半径 400（A2-1 の外の地面の外周）〜 1100、高さ -0.5。外の地面と同じ材質（霧で地平線の色へ溶ける）
 *   丘          半径 700、高さ 6〜約 45m の帯（全周）
 *   街          半径 1000、方位 95°〜215°、高さ 8〜約 40m の家並み・塔の影絵（画質の「背景の密度を下げる」段階では描かない）
 *
 * - 丘と街は霧ではなく、自前のかすみ（地平線の色へ寄せる量。下ほど強い）で色を決める。カメラの位置によらず、遠いほど淡い。
 * - 帯どうし（700m と 1000m）・地面（-0.5）は十分に離して置き、奥行きの競合（ちらつき）を避ける。
 * - 影は落とさず受けもしない。光源の計算もしない（丘・街は単色の影絵）。
 */

const GROUND_Y = -COLOSSEUM.platformHeight;
const FAR_GROUND_OUTER = 1100;
const HILLS_RADIUS = 700;
const HILLS_SEGMENTS = 256;
const CITY_RADIUS = 1000;
const CITY_FROM_DEG = 95;
const CITY_TO_DEG = 215;

const SILHOUETTE_VERTEX = /* glsl */ `
varying float vY;
void main() {
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SILHOUETTE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHaze;
uniform float uHazeTop;
uniform float uHazeBottom;
uniform float uHazeHeight;
varying float vY;
void main() {
  float haze = mix(uHazeBottom, uHazeTop, smoothstep(0.0, uHazeHeight, vY));
  gl_FragColor = vec4(mix(uColor, uHaze, haze), 1.0);
}`;

function silhouetteMaterial(name: string, color: string, hazeTop: number, hazeBottom: number, hazeHeight: number): ShaderMaterial {
  return new ShaderMaterial({
    name,
    side: DoubleSide,
    uniforms: {
      uColor: { value: new Color(color) },
      uHaze: { value: new Color(PALETTE.envSky.horizon) },
      uHazeTop: { value: hazeTop },
      uHazeBottom: { value: hazeBottom },
      uHazeHeight: { value: hazeHeight },
    },
    vertexShader: SILHOUETTE_VERTEX,
    fragmentShader: SILHOUETTE_FRAGMENT,
  });
}

/** 丘の帯：全周、上端の高さを周期の違う正弦波の和で決める（決定的） */
export function createHillsGeometry(): BufferGeometry {
  const rand = createRandom(4242);
  const waves = [3, 5, 8, 13, 21].map((k) => ({ k, phase: rand() * Math.PI * 2, amp: 14 / Math.sqrt(k) }));
  const height = (a: number) => {
    let h = 22;
    for (const w of waves) h += w.amp * Math.sin(w.k * a + w.phase);
    return Math.max(6, h);
  };
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= HILLS_SEGMENTS; i++) {
    const a = (i / HILLS_SEGMENTS) * Math.PI * 2;
    const x = Math.sin(a) * HILLS_RADIUS;
    const z = Math.cos(a) * HILLS_RADIUS;
    pos.push(x, GROUND_Y, z, x, height(a), z);
    if (i < HILLS_SEGMENTS) {
      const b = i * 2;
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

/** 街の影絵：方位の範囲に、幅・高さの違う建物を並べる（建物ごとの長方形。決定的） */
export function createCityGeometry(): BufferGeometry {
  const rand = createRandom(7331);
  const pos: number[] = [];
  const index: number[] = [];
  let a = (CITY_FROM_DEG * Math.PI) / 180;
  const end = (CITY_TO_DEG * Math.PI) / 180;
  while (a < end) {
    const width = 8 + rand() * 22;
    const da = width / CITY_RADIUS;
    // 端ほど低く（街の外れ）、ところどころ高い塔
    const t = (a - (CITY_FROM_DEG * Math.PI) / 180) / (end - (CITY_FROM_DEG * Math.PI) / 180);
    const edge = Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
    // 低い家並みと、ところどころの塔（古い街並み。高層の建物にはしない）
    const tower = rand() < 0.06 ? 1.6 : 1;
    const h = (8 + rand() * 18 * edge) * tower;
    const a1 = Math.min(a + da, end);
    const base = pos.length / 3;
    for (const [ang, y] of [
      [a, GROUND_Y],
      [a1, GROUND_Y],
      [a1, h],
      [a, h],
    ] as const) {
      pos.push(Math.sin(ang) * CITY_RADIUS, y, Math.cos(ang) * CITY_RADIUS);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    a = a1 + (rand() < 0.3 ? rand() * 6 : 0) / CITY_RADIUS; // ところどころ建物の間をあける
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

export class FarView {
  readonly ground: Mesh;
  readonly hills: Mesh;
  readonly city: Mesh;

  constructor() {
    // 分割数（192）と開始角は A2-1 の外の地面と同じにして、半径 400 の境目の頂点を一致させる（すき間・重なりを作らない）
    const groundGeo = new RingGeometry(400, FAR_GROUND_OUTER, 192, 1);
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate(0, GROUND_Y, 0);
    const groundMat = new MeshStandardMaterial({ color: PALETTE.outerGround, roughness: 0.95 });
    groundMat.name = 'FarGround';
    this.ground = new Mesh(groundGeo, groundMat);
    this.ground.name = 'FarGround';

    this.hills = new Mesh(createHillsGeometry(), silhouetteMaterial('FarHills', PALETTE.farView.hills, 0.4, 0.8, 30));
    this.hills.name = 'FarHills';
    this.city = new Mesh(createCityGeometry(), silhouetteMaterial('FarCity', PALETTE.farView.city, 0.55, 0.88, 60));
    this.city.name = 'FarCity';
    for (const m of [this.ground, this.hills, this.city]) {
      m.castShadow = false;
      m.receiveShadow = false;
    }
  }

  get meshes(): Mesh[] {
    return [this.ground, this.hills, this.city];
  }

  /** 背景の密度：通常は丘と街の2重、下げた段階では丘の1重 */
  applyDensity(full: boolean): void {
    this.city.visible = full;
  }
}
