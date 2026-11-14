import { DirectionalLight, HemisphereLight, Scene, Vector3 } from 'three';
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
