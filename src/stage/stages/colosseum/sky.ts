import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { DEFAULT_SUN, sunDirection, type SunAngles } from './lighting';
import { PALETTE } from './palette';

/**
 * 夕暮れの空（A2-3）。空のドームと環境マップ（PMREM）が同じシェーダーを使う。
 *
 * - 天頂から地平線へのグラデーション（地平線より下は地面の色へ）
 * - 太陽の方向の明るみ（地平線の近くほど広く、暖かい色）と、小さな太陽の円盤
 * - 霧の影響は受けない（シェーダーで霧を計算しない）。奥行き情報も書き込まない（最初に描き、ほかの物が上に描かれる）
 *
 * 環境マップは、最初の太陽の向き（DEFAULT_SUN）で一度だけ作る。開発パネルで太陽の向きを変えても、
 * 空のドームの明るみは追従するが、環境マップは作り直さない（開発用の機能のため、負荷を増やさない）。
 */

/** 空のドームの半径（カメラの描画範囲 3000m の内側。全景のカメラ（最大でも約 250m）より十分遠い） */
export const SKY_DOME_RADIUS = 1500;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;
  // 地平線の暖色は低い空（約20°まで）に留め、上は夜に向かう青紫へ
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.35, y));
  // 太陽の明るみ：太陽の方向ほど明るく、地平線に近いほど広がる
  float c = max(dot(dir, uSunDir), 0.0);
  float nearHorizon = 1.0 - smoothstep(0.0, 0.5, abs(y));
  float glow = pow(c, 8.0) * 0.55 + pow(c, 3.0) * 0.25 * nearHorizon;
  float disc = smoothstep(0.9993, 0.9997, c);
  sky += uSunColor * (glow * uSunGlow + disc * 2.5);
  vec3 col = y >= 0.0 ? sky : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -y));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SkyMaterial extends ShaderMaterial {
  uniforms: {
    uZenith: { value: Color };
    uHorizon: { value: Color };
    uGround: { value: Color };
    uSunDir: { value: Vector3 };
    uSunColor: { value: Color };
    uSunGlow: { value: number };
  };
}

/** 空のシェーダー（ドームと環境マップで共通）。内側から見る球に使う */
export function createSkyMaterial(sun: SunAngles = DEFAULT_SUN): SkyMaterial {
  const S = PALETTE.envSky;
  return new ShaderMaterial({
    name: 'Sky',
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new Color(S.zenith) },
      uHorizon: { value: new Color(S.horizon) },
      uGround: { value: new Color(S.ground) },
      uSunDir: { value: sunDirection(sun) },
      uSunColor: { value: new Color(PALETTE.light.sun) },
      uSunGlow: { value: 1 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
  }) as SkyMaterial;
}

/** 空のドーム。最初に描き（renderOrder）、奥行き情報を書き込まず、霧の影響を受けない */
export class SkyDome {
  readonly mesh: Mesh;
  private readonly material: SkyMaterial;

  constructor() {
    this.material = createSkyMaterial();
    this.mesh = new Mesh(new SphereGeometry(SKY_DOME_RADIUS, 48, 24), this.material);
    this.mesh.name = 'SkyDome';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  /** 太陽の向きに明るみを追従させる（開発パネルから） */
  setSun(angles: SunAngles): void {
    sunDirection(angles, this.material.uniforms.uSunDir.value);
  }
}

/**
 * 環境マップ（PMREM）。空のドームと同じシェーダーで、最初の太陽の向きの空を一度だけ描いて作る（ブロンズの映り込みと環境光）。
 * GPU 上で描いて作るため、コンテキスト復帰時には作り直しが必要（ColosseumStage.regenerateGpuResources）。
 */
export function createEnvironmentMap(renderer: WebGLRenderer): WebGLRenderTarget {
  const scene = new Scene();
  const material = createSkyMaterial();
  const geometry = new SphereGeometry(50, 32, 16);
  scene.add(new Mesh(geometry, material));

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02);
  // 生成器と、生成に使った一時的な資源はすぐに解放する（残すのは結果の RenderTarget だけ）
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  target.texture.name = 'ColosseumEnvironment';
  return target;
}
