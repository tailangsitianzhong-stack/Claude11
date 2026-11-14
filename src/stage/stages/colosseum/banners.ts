import { BufferAttribute, Color, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3, type BufferGeometry } from 'three';
import { installShaderPatch, type ShaderPatch } from '../../../render/internal/threeShaderPatch';
import { COLOSSEUM } from './layout';
import { PALETTE } from './palette';

/**
 * バナー（A2-3）：外壁の内側の面の、アーチの間の柱（区画の境目）に垂らす布。
 *
 * - 18枚：36区画の境目（5°, 15°, …）のうち1つおき（アーチ2つおき）。5°, 25°, …, 345°
 * - 大きさ：幅 1.6m、長さ 4.4m（上端 11.55m、下端の先 7.15m。回廊の床 6.62m の 0.5m 上まで）。下端は三角にとがらせる
 * - 色：ブロンズ・深紅・群青を順に（彩度・明るさを抑え、キャラクター（A3）より目立たない）。InstancedMesh の色で区別する
 * - 揺れ：頂点シェーダーで、上端を固定して下ほど大きく、戦闘エリアの側へだけふくらむ（壁にめり込まない）
 * - 画質：背景の密度を下げた段階では、揺れを止め、9枚（1つおき）に減らす
 * - 影は落とさず受けもしない（影の範囲（半径21）の外）。描画は1回（6基のかがり火などと同じく InstancedMesh）
 */

export const BANNER_SHADER_MARKER = 'COLOSSEUM_BANNER_SWAY_v1';

export const BANNER = {
  count: 18,
  reducedCount: 9,
  width: 1.6,
  length: 4.4,
  /** 下端の三角の深さ */
  tip: 0.45,
  /** 上端の高さ（床面から。外壁の内側の上端の蛇腹（11.72〜12）のすぐ下） */
  top: 11.55,
  /** 中心線の半径（外壁の内側の面の角は半径 37。布の端でも壁から 7cm 以上離れる） */
  radius: 36.86,
  /** 揺れの大きさ（下端での最大のふくらみ m） */
  swayAmplitude: 0.18,
} as const;

/** バナーの角度（度）：区画の境目（5° + 10°×i）のうち1つおき。並びは「1つおきの9枚」を先にして、減らすときは先頭から使う */
export function bannerAnglesDeg(): number[] {
  const step = 360 / COLOSSEUM.archBayCount;
  const all = Array.from({ length: BANNER.count }, (_, k) => step / 2 + step * 2 * k);
  return [...all.filter((_, k) => k % 2 === 0), ...all.filter((_, k) => k % 2 === 1)];
}

/** 布の形：上端が y=0、下へ伸びる（-y）。表は +z（戦闘エリアの側）。下端の中央をとがらせる */
export function createBannerGeometry(): BufferGeometry {
  const B = BANNER;
  const rows = 8;
  // 長さ（4.4m）は下端の三角の先まで。四角い部分は三角の深さぶん短い
  const body = B.length - B.tip;
  const geo = new PlaneGeometry(B.width, body, 2, rows);
  geo.translate(0, -body / 2, 0);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // 下端の行：中央をとがらせ、両端は少し上げる（燕尾ではなく、1つの三角）
    if (Math.abs(y + body) < 1e-6) pos.setY(i, y - (Math.abs(x) < 1e-6 ? B.tip : 0) + (Math.abs(x) > 1e-6 ? B.tip * 0.2 : 0));
    // 上端の折り返し（暗い帯）と、下ほど少し暗い
    const t = -pos.getY(i) / B.length;
    const v = (t < 0.07 ? 0.7 : 1) * (1 - 0.15 * t);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export class Banners {
  readonly mesh: InstancedMesh;
  private readonly time = { value: 0 };
  private readonly amplitude: { value: number } = { value: BANNER.swayAmplitude };
  private swaying = true;

  constructor() {
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true });
    material.name = 'Banner';
    const patch: ShaderPatch = {
      marker: BANNER_SHADER_MARKER,
      uniforms: { uBannerTime: this.time, uBannerAmp: this.amplitude },
      vertex: [
        { anchor: '#include <common>', code: 'uniform float uBannerTime;\nuniform float uBannerAmp;' },
        {
          anchor: '#include <begin_vertex>',
          // 上端（y=0）を固定し、下ほど大きく揺らす。z は戦闘エリアの側（+z）へだけ。基ごとに位相をずらす
          code: `{
  float down = clamp(-transformed.y / ${BANNER.length.toFixed(2)}, 0.0, 1.2);
  float ph = float(gl_InstanceID) * 1.73;
  float w = 0.5 + 0.5 * sin(uBannerTime * 1.1 + ph - down * 1.6);
  transformed.z += uBannerAmp * down * down * w;
  transformed.x += uBannerAmp * 0.25 * down * down * sin(uBannerTime * 0.7 + ph * 1.3);
}`,
        },
      ],
      fragment: [],
    };
    // 差し込みに失敗しても、揺れない布として描く
    installShaderPatch(material, patch, (error) => {
      console.warn(`[Banners] バナーの揺れを使わずに描画します（${error.message}）`);
    });

    const angles = bannerAnglesDeg();
    this.mesh = new InstancedMesh(createBannerGeometry(), material, angles.length);
    this.mesh.name = 'Banners';
    const colors = [PALETTE.banner.bronze, PALETTE.banner.crimson, PALETTE.banner.navy].map((c) => new Color(c));
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    const p = new Vector3();
    // 色は角度の順にブロンズ・深紅・群青を繰り返す（減らしたときも3色がそろう）
    const sorted = [...angles].sort((a, b) => a - b);
    angles.forEach((deg, i) => {
      const a = (deg * Math.PI) / 180;
      p.set(Math.sin(a) * BANNER.radius, BANNER.top, Math.cos(a) * BANNER.radius);
      // 表（+z）を戦闘エリアの中心へ向ける
      q.setFromAxisAngle(up, a + Math.PI);
      this.mesh.setMatrixAt(i, m.compose(p, q, one));
      this.mesh.setColorAt(i, colors[sorted.indexOf(deg) % colors.length]!);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /** 固定間隔のゲーム処理から呼ぶ。揺れているときだけ時間を進める */
  update(dt: number): void {
    if (this.swaying) this.time.value = (this.time.value + dt) % 3600;
  }

  /** 背景の密度：通常は18枚で揺らす。下げた段階では9枚で揺らさない */
  applyDensity(full: boolean): void {
    this.swaying = full;
    this.amplitude.value = full ? BANNER.swayAmplitude : 0;
    this.mesh.count = full ? BANNER.count : BANNER.reducedCount;
  }

  /** 揺れのシェーダーのコンパイルに失敗したとき：差し込みを外して、揺れない布にする */
  disableSway(): void {
    const mat = this.mesh.material as MeshStandardMaterial;
    mat.onBeforeCompile = () => {};
    mat.customProgramCacheKey = () => 'banner-static';
    mat.needsUpdate = true;
    this.swaying = false;
  }

  /** テスト用 */
  get timeValue(): number {
    return this.time.value;
  }
}
