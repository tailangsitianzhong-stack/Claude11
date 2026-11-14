import { Color, type Bone, type Mesh, type Object3D } from 'three';
import type { QualityLevelSettings } from '../platform/QualitySettings';
import { applyPartColor, colorSlotOf, createBodyMaterial, createOutlineMaterial, createOutlineMesh, type Appearance } from './appearance';
import { attachBodyMeshes, createBodyParts } from './bodyMeshes';
import type { BodyProfile } from './bodyProfile';
import { clampJointRotation } from './jointLimits';
import { buildSkeleton, type JointName, type SocketName } from './skeleton';

const DEG = Math.PI / 180;

/**
 * 立ち姿（A3 CP1 の提案値）：基準の姿勢（腕を真下）のままだと上腕が胸の側面にめり込むため、
 * 肩を少し開き、肘を少し曲げて立たせる。アニメーション（C）ではない固定の姿勢。
 */
export const STANDING_POSE: Partial<Record<JointName, { x: number; y: number; z: number }>> = {
  shoulder_L: { x: 0, y: 0, z: 12 },
  shoulder_R: { x: 0, y: 0, z: -12 },
  elbow_L: { x: -10, y: 0, z: 0 },
  elbow_R: { x: -10, y: 0, z: 0 },
};

/**
 * キャラクターの身体（A3）：骨格・部位のメッシュ・ソケット・見た目（色・陰影・リムライト・輪郭線）。動き・操作は後の工程（B・C）。
 * シーンに追加すれば、GPU 資源はステージの共通の解放処理（コンテキスト喪失・破棄）で扱われる。
 */
export class CharacterBody {
  readonly root: Object3D;
  readonly visualRoot: Object3D;
  readonly bones: Record<JointName, Bone>;
  readonly sockets: Record<SocketName, Object3D>;
  /** 体の部位のメッシュ（輪郭線を除く） */
  readonly meshes: Mesh[];
  /** 輪郭線のメッシュ（画質の段階7以降は非表示） */
  readonly outlines: Mesh[] = [];

  constructor(
    readonly profile: BodyProfile,
    readonly appearance: Appearance,
  ) {
    const sk = buildSkeleton(profile);
    this.root = sk.root;
    this.root.name = `Character_${profile.id}`;
    this.visualRoot = sk.visualRoot;
    this.bones = sk.bones;
    this.sockets = sk.sockets;
    const warn = (what: string) => (e: Error) => console.warn(`[CharacterBody] ${what}を使わずに描画します（${e.message}）`);
    // 1体につき体のマテリアル1つ（部位の色と陰影は頂点の色）、輪郭線のマテリアル1つ
    const material = createBodyMaterial(`CharacterBody_${profile.id}`, warn('リムライト'));
    const outlineMaterial = createOutlineMaterial(`CharacterOutline_${profile.id}`, warn('輪郭線の膨らみ'));
    const parts = createBodyParts(profile);
    for (const part of parts) applyPartColor(part.geometry, new Color(appearance.colors[colorSlotOf(part.name)]));
    this.meshes = attachBodyMeshes(this.bones, parts, material);
    for (const mesh of this.meshes) {
      const outline = createOutlineMesh(mesh, outlineMaterial);
      mesh.parent!.add(outline);
      this.outlines.push(outline);
    }
  }

  /** 画質：輪郭線は settings.outline（段階0〜6 は表示、段階7〜9 は非表示） */
  applyQuality(settings: Readonly<QualityLevelSettings>): void {
    for (const o of this.outlines) o.visible = settings.outline;
  }

  /** ソケットに物を付ける（ソケットの座標系に合わせて置く） */
  attach(socket: SocketName, object: Object3D): void {
    this.sockets[socket].add(object);
  }

  /** 関節の回転（度）を、回転の上限の範囲に収めて設定する。実際に設定した値を返す */
  setJointRotationDeg(name: JointName, deg: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const c = clampJointRotation(name, deg);
    this.bones[name].rotation.set(c.x * DEG, c.y * DEG, c.z * DEG);
    return c;
  }

  /** 全関節を基準の姿勢（回転 0）に戻してから、指定の姿勢を設定する */
  applyPoseDeg(pose: Partial<Record<JointName, { x: number; y: number; z: number }>>): void {
    for (const bone of Object.values(this.bones)) bone.rotation.set(0, 0, 0);
    for (const [name, deg] of Object.entries(pose)) this.setJointRotationDeg(name as JointName, deg!);
  }
}
