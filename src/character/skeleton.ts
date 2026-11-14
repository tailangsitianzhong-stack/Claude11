import { Bone, Object3D } from 'three';
import { computeLayout, type BodyProfile } from './bodyProfile';

/**
 * 骨格（A3。DESIGN_DECISIONS 9章）：17個の関節（THREE.Bone）。その上に root（接地点）と visualRoot（見た目だけの揺れ用）。
 *
 *   root → visualRoot → hips ─┬─ spine → chest ─┬─ neck → head
 *                              │                  ├─ shoulder_L → elbow_L → wrist_L
 *                              │                  └─ shoulder_R → elbow_R → wrist_R
 *                              ├─ hip_L → knee_L → ankle_L
 *                              └─ hip_R → knee_R → ankle_R
 *
 * 向き：正面は +Z、左は +X、上は +Y。全関節の回転が 0 の姿勢（基準の姿勢）は、腕を真下に下ろした直立。
 */

export const JOINT_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder_L',
  'elbow_L',
  'wrist_L',
  'shoulder_R',
  'elbow_R',
  'wrist_R',
  'hip_L',
  'knee_L',
  'ankle_L',
  'hip_R',
  'knee_R',
  'ankle_R',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

/** 親の関節（hips の親は visualRoot） */
export const JOINT_PARENT: Readonly<Record<JointName, JointName | null>> = Object.freeze({
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  shoulder_L: 'chest',
  elbow_L: 'shoulder_L',
  wrist_L: 'elbow_L',
  shoulder_R: 'chest',
  elbow_R: 'shoulder_R',
  wrist_R: 'elbow_R',
  hip_L: 'hips',
  knee_L: 'hip_L',
  ankle_L: 'knee_L',
  hip_R: 'hips',
  knee_R: 'hip_R',
  ankle_R: 'knee_R',
});

export const SOCKET_NAMES = ['hand_L', 'hand_R', 'foot_L', 'foot_R', 'head', 'chest', 'core', 'weapon_L', 'weapon_R'] as const;
export type SocketName = (typeof SOCKET_NAMES)[number];

/** ソケットを付ける関節 */
export const SOCKET_PARENT: Readonly<Record<SocketName, JointName>> = Object.freeze({
  hand_L: 'wrist_L',
  hand_R: 'wrist_R',
  weapon_L: 'wrist_L',
  weapon_R: 'wrist_R',
  foot_L: 'ankle_L',
  foot_R: 'ankle_R',
  head: 'head',
  chest: 'chest',
  core: 'hips',
});

/** 胴の関節（spine）を腰の上端から、胸の関節（chest）を胸の下端からどれだけ上に置くか（提案値） */
const CHEST_JOINT_ABOVE_SPINE = 0.1;

/** 立った状態での各関節の位置（体の基準の座標。足の裏 y=0） */
export function jointRestPositions(p: BodyProfile): Record<JointName, [number, number, number]> {
  const L = computeLayout(p);
  const out = {} as Record<JointName, [number, number, number]>;
  out.hips = [0, (L.waistBottomY + L.chestBottomY) / 2, 0];
  out.spine = [0, L.chestBottomY, 0];
  out.chest = [0, L.chestBottomY + CHEST_JOINT_ABOVE_SPINE, 0];
  out.neck = [0, L.chestTopY, 0];
  out.head = [0, L.headBottomY, 0];
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    out[`shoulder_${side}`] = [sx * L.shoulderX, L.shoulderY, 0];
    out[`elbow_${side}`] = [sx * L.shoulderX, L.elbowY, 0];
    out[`wrist_${side}`] = [sx * L.shoulderX, L.wristY, 0];
    out[`hip_${side}`] = [sx * L.hipX, L.hipJointY, 0];
    out[`knee_${side}`] = [sx * L.hipX, L.kneeY, 0];
    out[`ankle_${side}`] = [sx * L.hipX, L.ankleY, 0];
  }
  return out;
}

/** ソケットの位置（関節からの相対位置）と向き（x 軸まわりの回転、度）。提案値 */
export function socketOffsets(p: BodyProfile): Record<SocketName, { pos: [number, number, number]; rotXDeg: number }> {
  const fist = -p.hand.h / 2; // 握り拳の中心
  const footCenterZ = (p.toe - p.heel) / 2;
  return {
    hand_L: { pos: [0, fist, 0], rotXDeg: 0 },
    hand_R: { pos: [0, fist, 0], rotXDeg: 0 },
    // 武器を握る位置：拳の中心。ソケットの +Y が刃の向き（腕を下ろした姿勢で正面 +Z を向く）
    weapon_L: { pos: [0, fist, 0], rotXDeg: 90 },
    weapon_R: { pos: [0, fist, 0], rotXDeg: 90 },
    // 足の裏の中心（足首の真下の地面、足の長さの中央）
    foot_L: { pos: [0, -p.foot.h, footCenterZ], rotXDeg: 0 },
    foot_R: { pos: [0, -p.foot.h, footCenterZ], rotXDeg: 0 },
    head: { pos: [0, p.head.h / 2, 0], rotXDeg: 0 },
    chest: { pos: [0, p.chest.h / 2 - CHEST_JOINT_ABOVE_SPINE, 0], rotXDeg: 0 },
    core: { pos: [0, 0, 0], rotXDeg: 0 },
  };
}

export interface Skeleton {
  root: Object3D;
  visualRoot: Object3D;
  bones: Record<JointName, Bone>;
  sockets: Record<SocketName, Object3D>;
}

export function buildSkeleton(p: BodyProfile): Skeleton {
  const root = new Object3D();
  root.name = 'root';
  const visualRoot = new Object3D();
  visualRoot.name = 'visualRoot';
  root.add(visualRoot);

  const rest = jointRestPositions(p);
  const bones = {} as Record<JointName, Bone>;
  for (const name of JOINT_NAMES) {
    const bone = new Bone();
    bone.name = name;
    const parent = JOINT_PARENT[name];
    const [x, y, z] = rest[name];
    if (parent) {
      const [px, py, pz] = rest[parent];
      bone.position.set(x - px, y - py, z - pz);
      bones[parent].add(bone);
    } else {
      bone.position.set(x, y, z);
      visualRoot.add(bone);
    }
    bones[name] = bone;
  }

  const offsets = socketOffsets(p);
  const sockets = {} as Record<SocketName, Object3D>;
  for (const name of SOCKET_NAMES) {
    const s = new Object3D();
    s.name = `socket_${name}`;
    const o = offsets[name];
    s.position.set(...o.pos);
    s.rotation.x = (o.rotXDeg * Math.PI) / 180;
    bones[SOCKET_PARENT[name]].add(s);
    sockets[name] = s;
  }
  return { root, visualRoot, bones, sockets };
}
