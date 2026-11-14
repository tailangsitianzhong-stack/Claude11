import type { JointName } from './skeleton';

/**
 * 関節ごとの回転の上限（JointLimits。A3 CP1 の提案値。DESIGN_DECISIONS 9-4 の未確定事項）。
 *
 * - 角度は度。関節の基準の姿勢（直立・腕を下ろす）からの回転で、オイラー角（XYZ の順）の各軸の範囲。
 * - 軸と符号（体の座標：正面 +Z、左 +X、上 +Y）：
 *   - X 軸（前後に振る）：負 = 腕・脚を前へ上げる／肘を曲げる、正 = 膝を曲げる・後ろへ振る
 *   - Z 軸（横に開く）：左側（_L）は正、右側（_R）は負で外へ開く
 *   - Y 軸（ひねる）
 * - 9-5 の極端な姿勢（肘・膝 140°、肩 170°、股関節 90°の蹴り上げ、胴の 45°のひねり）が範囲内に入ること。
 */
export interface AxisRange {
  min: number;
  max: number;
}
export interface JointLimit {
  x: AxisRange;
  y: AxisRange;
  z: AxisRange;
}

const r = (min: number, max: number): AxisRange => ({ min, max });

function mirrored(limitL: JointLimit): JointLimit {
  // 右側：Y・Z の符号を反転（X はそのまま）
  return { x: limitL.x, y: r(-limitL.y.max, -limitL.y.min), z: r(-limitL.z.max, -limitL.z.min) };
}

const shoulderL: JointLimit = { x: r(-170, 60), y: r(-90, 90), z: r(-20, 170) };
const elbowL: JointLimit = { x: r(-145, 0), y: r(0, 0), z: r(0, 0) };
const wristL: JointLimit = { x: r(-70, 70), y: r(-80, 80), z: r(-30, 30) };
const hipL: JointLimit = { x: r(-110, 30), y: r(-40, 40), z: r(-15, 60) };
const kneeL: JointLimit = { x: r(0, 145), y: r(0, 0), z: r(0, 0) };
const ankleL: JointLimit = { x: r(-40, 40), y: r(0, 0), z: r(-20, 20) };

export const JOINT_LIMITS: Readonly<Record<JointName, JointLimit>> = Object.freeze({
  hips: { x: r(-30, 30), y: r(-45, 45), z: r(-20, 20) },
  spine: { x: r(-45, 30), y: r(-45, 45), z: r(-25, 25) },
  chest: { x: r(-20, 20), y: r(-20, 20), z: r(-15, 15) },
  neck: { x: r(-40, 40), y: r(-60, 60), z: r(-30, 30) },
  head: { x: r(-30, 30), y: r(-30, 30), z: r(-20, 20) },
  shoulder_L: shoulderL,
  elbow_L: elbowL,
  wrist_L: wristL,
  shoulder_R: mirrored(shoulderL),
  elbow_R: elbowL,
  wrist_R: mirrored(wristL),
  hip_L: hipL,
  knee_L: kneeL,
  ankle_L: ankleL,
  hip_R: mirrored(hipL),
  knee_R: kneeL,
  ankle_R: mirrored(ankleL),
});

const clamp = (v: number, a: AxisRange) => Math.min(Math.max(v, a.min), a.max);

/** 回転（度）を関節の上限の範囲に収める */
export function clampJointRotation(name: JointName, deg: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const lim = JOINT_LIMITS[name];
  return { x: clamp(deg.x, lim.x), y: clamp(deg.y, lim.y), z: clamp(deg.z, lim.z) };
}
