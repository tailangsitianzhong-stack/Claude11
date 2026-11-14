import { describe, expect, it } from 'vitest';
import { Vector3, type Mesh } from 'three';
import { CharacterBody, STANDING_POSE } from '../src/character/CharacterBody';
import { APPEARANCE_A, APPEARANCE_B } from '../src/character/appearance';
import { BODY_A, BODY_B } from '../src/character/bodyProfile';
import { createDummySword } from '../src/character/dummySword';
import { JOINT_LIMITS } from '../src/character/jointLimits';
import { JOINT_NAMES } from '../src/character/skeleton';
import { EXTREME_POSE } from '../src/debug/characterChecks';
import { characterPositions, framing } from '../src/viewer/viewerLayout';
import { applyPosePreset, editableAxes, readJointDeg, setJointAxisDeg, type Deg3 } from '../src/viewer/viewerPose';

const close = (a: Deg3, b: Deg3) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};
const ZERO = { x: 0, y: 0, z: 0 };

describe('ビューアーの関節の操作（A4 CP2）', () => {
  it('スライダーの入力は回転の上限で止まる（全関節・全軸の上下限の外側）', () => {
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    for (const joint of JOINT_NAMES) {
      const lim = JOINT_LIMITS[joint];
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(setJointAxisDeg(body, joint, axis, lim[axis].max + 50)![axis]).toBe(lim[axis].max);
        expect(readJointDeg(body, joint)[axis]).toBeCloseTo(lim[axis].max, 6);
        expect(setJointAxisDeg(body, joint, axis, lim[axis].min - 50)![axis]).toBe(lim[axis].min);
        expect(readJointDeg(body, joint)[axis]).toBeCloseTo(lim[axis].min, 6);
        // 上限ちょうどの値はそのまま
        expect(setJointAxisDeg(body, joint, axis, lim[axis].max)![axis]).toBe(lim[axis].max);
      }
    }
  });

  it('1つの軸の入力は、ほかの軸の値を変えない', () => {
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    setJointAxisDeg(body, 'shoulder_L', 'z', 90);
    setJointAxisDeg(body, 'shoulder_L', 'x', -45);
    setJointAxisDeg(body, 'shoulder_L', 'y', 30);
    close(readJointDeg(body, 'shoulder_L'), { x: -45, y: 30, z: 90 });
  });

  it('数値でない入力（NaN・無限大・文字列）は適用しない', () => {
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    setJointAxisDeg(body, 'elbow_L', 'x', -60);
    for (const bad of [NaN, Infinity, -Infinity, '30' as unknown as number, undefined as unknown as number]) {
      expect(setJointAxisDeg(body, 'elbow_L', 'x', bad)).toBeNull();
      close(readJointDeg(body, 'elbow_L'), { x: -60, y: 0, z: 0 });
    }
    expect(Number.isFinite(body.bones.elbow_L.quaternion.w)).toBe(true);
  });

  it('動かせる軸は上限の範囲に幅がある軸だけ（肘・膝は X だけ）', () => {
    expect(editableAxes('elbow_L')).toEqual(['x']);
    expect(editableAxes('knee_R')).toEqual(['x']);
    expect(editableAxes('ankle_L')).toEqual(['x', 'z']);
    expect(editableAxes('shoulder_R')).toEqual(['x', 'y', 'z']);
    // 動かせない軸に値を入れても 0 のまま
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    expect(setJointAxisDeg(body, 'elbow_L', 'y', 40)!.y).toBe(0);
  });

  it('スライダーで極端な姿勢（9-5）を再現でき、プリセットの極端な姿勢と一致する', () => {
    const bySlider = new CharacterBody(BODY_B, APPEARANCE_B);
    for (const [joint, deg] of Object.entries(EXTREME_POSE)) {
      for (const axis of ['x', 'y', 'z'] as const) setJointAxisDeg(bySlider, joint as keyof typeof EXTREME_POSE, axis, deg![axis]);
    }
    const byPreset = new CharacterBody(BODY_B, APPEARANCE_B);
    applyPosePreset(byPreset, 'extreme');
    for (const joint of JOINT_NAMES) {
      close(readJointDeg(bySlider, joint), readJointDeg(byPreset, joint));
      // 極端な姿勢は上限の内側（切り詰められていない）
      close(readJointDeg(byPreset, joint), EXTREME_POSE[joint] ?? ZERO);
    }
  });

  it('複数の関節を動かしたあとでも、基準の姿勢・立ち姿・極端な姿勢に正確に戻る', () => {
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    const scramble = () => {
      for (const joint of JOINT_NAMES) for (const axis of editableAxes(joint)) setJointAxisDeg(body, joint, axis, JOINT_LIMITS[joint][axis].min + 7);
    };
    for (const [preset, pose] of [
      ['rest', {}],
      ['standing', STANDING_POSE],
      ['extreme', EXTREME_POSE],
    ] as const) {
      scramble();
      applyPosePreset(body, preset);
      for (const joint of JOINT_NAMES) close(readJointDeg(body, joint), (pose as Partial<Record<string, Deg3>>)[joint] ?? ZERO);
    }
  });
});

describe('極端な姿勢の表示範囲（A4 CP2）', () => {
  /** 体のすべての頂点（剣を含む）のうち、注視点から最も遠い点までの距離 */
  const farthest = (bodies: { body: CharacterBody; x: number }[], center: Vector3) => {
    let max = 0;
    const v = new Vector3();
    for (const { body, x } of bodies) {
      body.root.position.set(x, 0, 0);
      body.root.updateMatrixWorld(true);
      body.root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) max = Math.max(max, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).distanceTo(center));
      });
    }
    return max;
  };
  const make = (preset: 'standing' | 'extreme') => {
    const a = new CharacterBody(BODY_A, APPEARANCE_A);
    const b = new CharacterBody(BODY_B, APPEARANCE_B);
    b.attach('weapon_R', createDummySword().root);
    applyPosePreset(a, preset);
    applyPosePreset(b, preset);
    return { a, b };
  };

  it('極端な姿勢では体（剣を含む）の全体が球に収まる。範囲を広げるのは1体の表示だけ', () => {
    const { a, b } = make('extreme');
    for (const sel of ['A', 'B', 'AB'] as const) {
      const pos = characterPositions(sel);
      const shown = [
        ...(pos.A !== null ? [{ body: a, x: pos.A }] : []),
        ...(pos.B !== null ? [{ body: b, x: pos.B }] : []),
      ];
      const f = framing(sel, true);
      expect(farthest(shown, f.center)).toBeLessThanOrEqual(f.radius);
      if (sel === 'AB') {
        // 2体の比較は通常の範囲のままで収まる（範囲を変えない）
        expect(f).toEqual(framing('AB'));
      } else {
        // 1体の表示では、通常の範囲では収まらない（だから広げる）
        expect(farthest(shown, framing(sel).center)).toBeGreaterThan(framing(sel).radius);
      }
    }
  });

  it('通常の姿勢の範囲は CP1 のまま（立ち姿は通常の範囲に収まる）', () => {
    expect(framing('A').center.toArray()).toEqual([0, 0.9, 0]);
    expect(framing('A').radius).toBe(1.05);
    expect(framing('AB').radius).toBe(1.55);
    const { a, b } = make('standing');
    expect(farthest([{ body: a, x: 0 }], framing('A').center)).toBeLessThanOrEqual(framing('A').radius);
    expect(farthest([{ body: b, x: 0 }], framing('B').center)).toBeLessThanOrEqual(framing('B').radius);
  });
});
