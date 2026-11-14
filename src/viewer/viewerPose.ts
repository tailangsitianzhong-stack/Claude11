import type { CharacterBody } from '../character/CharacterBody';
import { STANDING_POSE } from '../character/CharacterBody';
import { JOINT_LIMITS } from '../character/jointLimits';
import type { JointName } from '../character/skeleton';
import { EXTREME_POSE } from '../debug/characterChecks';

/**
 * ビューアー（A4 CP2）の関節の手動操作と姿勢のリセット（画面に依存しない部分。テスト対象）。DESIGN_DECISIONS 10章。
 *
 * - 入力した時点で回転の上限（JointLimits）を適用する（A3 の `setJointRotationDeg`。11-3）。
 * - 数値でない値（NaN・無限大）は適用しない（関節は変えない）。
 */

export type Axis = 'x' | 'y' | 'z';
export const AXES: readonly Axis[] = ['x', 'y', 'z'];
export type Deg3 = { x: number; y: number; z: number };

/** リセット先の姿勢：基準の姿勢（全関節 0）・立ち姿・極端な姿勢（9-5） */
export const POSE_PRESETS = {
  rest: {},
  standing: STANDING_POSE,
  extreme: EXTREME_POSE,
} as const satisfies Record<string, Partial<Record<JointName, Deg3>>>;
export type PosePreset = keyof typeof POSE_PRESETS;
export const POSE_PRESET_NAMES = Object.keys(POSE_PRESETS) as PosePreset[];
export const POSE_PRESET_LABELS: Readonly<Record<PosePreset, string>> = {
  rest: '基準の姿勢',
  standing: '立ち姿',
  extreme: '極端な姿勢',
};

const DEG = Math.PI / 180;

/** 動かせる軸（上限の範囲に幅がある軸。肘・膝の Y・Z などは 0 で固定） */
export function editableAxes(joint: JointName): Axis[] {
  const lim = JOINT_LIMITS[joint];
  return AXES.filter((a) => lim[a].max > lim[a].min);
}

/** 関節の今の回転（度。オイラー角 XYZ。`setJointRotationDeg` が設定した値をそのまま読む） */
export function readJointDeg(body: CharacterBody, joint: JointName): Deg3 {
  const r = body.bones[joint].rotation;
  return { x: r.x / DEG, y: r.y / DEG, z: r.z / DEG };
}

/**
 * 1つの軸の入力を関節に適用する。上限の範囲に切り詰めて設定し、実際に設定した回転を返す。
 * 数値でない入力は適用せず null を返す。
 */
export function setJointAxisDeg(body: CharacterBody, joint: JointName, axis: Axis, value: number): Deg3 | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const deg = readJointDeg(body, joint);
  deg[axis] = value;
  return body.setJointRotationDeg(joint, deg);
}

/** 姿勢のリセット（全関節を基準の姿勢に戻してから、指定の姿勢を設定する） */
export function applyPosePreset(body: CharacterBody, preset: PosePreset): void {
  body.applyPoseDeg(POSE_PRESETS[preset]);
}
