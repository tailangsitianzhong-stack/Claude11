import {
  BackSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { QualityLevelSettings } from '../../../platform/QualitySettings';
import { applyShadowQuality } from '../../../render/shadows';
import { PALETTE } from './palette';

/**
 * 太陽の向き。方位角は上から見て +Z（正面の視点がある側）を 0°、+X を 90° とする時計回り。
 * 初期値：仰角45°、方位300°（正面左の西寄りから照らし、柱の影が奥・右へ落ちる）。最終的な角度はプレビューを見て決める。
 */
export interface SunAngles {
  elevationDeg: number;
  azimuthDeg: number;
}
export const DEFAULT_SUN: Readonly<SunAngles> = Object.freeze({ elevationDeg: 45, azimuthDeg: 300 });

/** 太陽の方向（地面から太陽へ向かう単位ベクトル） */
export function sunDirection(angles: SunAngles, out = new Vector3()): Vector3 {
  const el = (angles.elevationDeg * Math.PI) / 180;
  const az = (angles.azimuthDeg * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/** 影の範囲（アリーナと柱を含む半径） */
const SHADOW_RADIUS = 21;
const SUN_DISTANCE = 60;

export class ArenaLights {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fill: DirectionalLight;
  private angles: SunAngles = { ...DEFAULT_SUN };

  constructor(scene: Scene) {
    const L = PALETTE.light;
    this.sun = new DirectionalLight(L.sun, 2.2);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_RADIUS;
    cam.right = SHADOW_RADIUS;
    cam.top = SHADOW_RADIUS;
    cam.bottom = -SHADOW_RADIUS;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2 + 20;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.target.position.set(0, 0, 0);

    this.hemi = new HemisphereLight(L.hemiSky, L.hemiGround, 0.9);
    // 太陽の反対側からの寒色の補助光（影の側が真っ黒につぶれないように。影は落とさない）
    this.fill = new DirectionalLight(L.fill, 0.45);

    scene.add(this.sun, this.sun.target, this.hemi, this.fill);
    this.setSun(DEFAULT_SUN);
  }

  get sunAngles(): Readonly<SunAngles> {
    return this.angles;
  }

  setSun(angles: SunAngles): void {
    this.angles = { ...angles };
    const dir = sunDirection(angles);
    this.sun.position.copy(dir).multiplyScalar(SUN_DISTANCE);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    this.fill.position.set(-dir.x, 0.6, -dir.z).normalize().multiplyScalar(SUN_DISTANCE);
  }

  applyQuality(s: Readonly<QualityLevelSettings>): void {
    applyShadowQuality(this.sun, s);
  }
}

/**
 * 環境マップ（PMREM）。夕暮れの空のグラデーションを一度だけ描いて作る（ブロンズの映り込みと環境光）。
 * GPU 上で描いて作るため、コンテキスト復帰時には作り直しが必要（ColosseumStage.regenerateGpuResources）。
 * A2-3 で空のドームを作ったら、そのシェーダーを共有する予定。
 */
export function createEnvironmentMap(renderer: WebGLRenderer): WebGLRenderTarget {
  const S = PALETTE.envSky;
  const scene = new Scene();
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new Color(S.zenith) },
      uHorizon: { value: new Color(S.horizon) },
      uGround: { value: new Color(S.ground) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      varying vec3 vDir;
      void main() {
        float y = normalize(vDir).y;
        vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, y));
        vec3 col = y >= 0.0 ? sky : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
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
