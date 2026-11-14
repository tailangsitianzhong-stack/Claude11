import { describe, expect, it } from 'vitest';
import { Box3, Quaternion, Vector3, type Object3D } from 'three';
import { CharacterBody, STANDING_POSE } from '../src/character/CharacterBody';
import { BODY_A, computeLayout } from '../src/character/bodyProfile';
import { APPEARANCE_A } from '../src/character/appearance';
import { JOINT_LIMITS, clampJointRotation } from '../src/character/jointLimits';
import { JOINT_NAMES, JOINT_PARENT, SOCKET_NAMES, SOCKET_PARENT } from '../src/character/skeleton';

const world = (body: CharacterBody, name: Parameters<CharacterBody['setJointRotationDeg']>[0]) => {
  body.root.updateMatrixWorld(true);
  return body.bones[name].getWorldPosition(new Vector3());
};

describe('体型A の寸法（A3 CP1）', () => {
  const body = new CharacterBody(BODY_A, APPEARANCE_A);
  body.root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(body.root);

  it('全高 1.80m（足の裏 0、頭の上端 1.80）', () => {
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.8, 3);
  });

  it('股関節 0.87m、肩 約1.38m、脚の長さは全高の約48%', () => {
    expect(world(body, 'hip_L').y).toBeCloseTo(0.87, 6);
    expect(world(body, 'hip_R').y).toBeCloseTo(0.87, 6);
    expect(world(body, 'shoulder_L').y).toBeCloseTo(1.38, 6);
    expect(world(body, 'shoulder_R').y).toBeCloseTo(1.38, 6);
    const legRatio = computeLayout(BODY_A).hipJointY / BODY_A.height;
    expect(legRatio).toBeGreaterThan(0.47);
    expect(legRatio).toBeLessThan(0.49);
  });

  it('腰の幅は正式値 0.42m、胸は上 0.50m・下 0.44m の台形', () => {
    const waist = body.meshes.find((m) => m.name === 'waist')!;
    waist.geometry.computeBoundingBox();
    const wb = waist.geometry.boundingBox!;
    expect(wb.max.x - wb.min.x).toBeCloseTo(0.42, 6);
    const chest = body.meshes.find((m) => m.name === 'chest')!;
    const pos = chest.geometry.getAttribute('position');
    let topW = 0;
    let bottomW = 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      yMin = Math.min(yMin, pos.getY(i));
      yMax = Math.max(yMax, pos.getY(i));
    }
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - yMax) < 1e-6) topW = Math.max(topW, Math.abs(pos.getX(i)) * 2);
      if (Math.abs(pos.getY(i) - yMin) < 1e-6) bottomW = Math.max(bottomW, Math.abs(pos.getX(i)) * 2);
    }
    // 角の丸めがあるので、上下の面の幅は丸めの分だけ狭い。比率で確かめる（0.44 / 0.50 = 0.88）
    expect(bottomW / topW).toBeCloseTo(0.88, 1);
  });

  it('左右対称（左の関節は +X、右は -X）', () => {
    for (const [l, r] of [
      ['shoulder_L', 'shoulder_R'],
      ['wrist_L', 'wrist_R'],
      ['hip_L', 'hip_R'],
      ['ankle_L', 'ankle_R'],
    ] as const) {
      const a = world(body, l);
      const b = world(body, r);
      expect(a.x).toBeGreaterThan(0);
      expect(a.x).toBeCloseTo(-b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
  });

  it('立ち姿：腕の先（拳の下端）が太ももの中ほど（0.62〜0.75m）に届く', () => {
    const b = new CharacterBody(BODY_A, APPEARANCE_A);
    b.applyPoseDeg(STANDING_POSE);
    b.root.updateMatrixWorld(true);
    const hand = new Box3().setFromObject(b.meshes.find((m) => m.name === 'hand_L')!);
    const thighMid = (computeLayout(BODY_A).hipJointY + computeLayout(BODY_A).kneeY) / 2;
    expect(hand.min.y).toBeGreaterThan(0.62);
    expect(hand.min.y).toBeLessThan(0.75);
    expect(Math.abs(hand.min.y - thighMid)).toBeLessThan(0.06);
  });
});

describe('骨格（A3 CP1）', () => {
  const body = new CharacterBody(BODY_A, APPEARANCE_A);

  it('関節は17個で、設計どおりの名前と親子関係（hips の親は visualRoot、その親は root）', () => {
    expect(JOINT_NAMES).toHaveLength(17);
    expect(new Set(JOINT_NAMES).size).toBe(17);
    for (const name of JOINT_NAMES) {
      const bone = body.bones[name];
      expect(bone.isBone).toBe(true);
      expect(bone.name).toBe(name);
      const parent = JOINT_PARENT[name];
      expect(bone.parent!.name).toBe(parent ?? 'visualRoot');
    }
    expect(body.visualRoot.parent).toBe(body.root);
  });

  it('階層：hips → spine → chest → neck → head、肩・肘・手首、股関節・膝・足首', () => {
    const chain = (name: (typeof JOINT_NAMES)[number]) => {
      const out: string[] = [];
      let o: Object3D | null = body.bones[name];
      while (o && o !== body.root) {
        out.unshift(o.name);
        o = o.parent;
      }
      return out.join('>');
    };
    expect(chain('head')).toBe('visualRoot>hips>spine>chest>neck>head');
    expect(chain('wrist_L')).toBe('visualRoot>hips>spine>chest>shoulder_L>elbow_L>wrist_L');
    expect(chain('wrist_R')).toBe('visualRoot>hips>spine>chest>shoulder_R>elbow_R>wrist_R');
    expect(chain('ankle_L')).toBe('visualRoot>hips>hip_L>knee_L>ankle_L');
    expect(chain('ankle_R')).toBe('visualRoot>hips>hip_R>knee_R>ankle_R');
  });

  it('ソケット：9個、所定の関節の子', () => {
    expect(SOCKET_NAMES).toHaveLength(9);
    for (const name of SOCKET_NAMES) {
      const s = body.sockets[name];
      expect(s.name).toBe(`socket_${name}`);
      expect(s.parent).toBe(body.bones[SOCKET_PARENT[name]]);
    }
    // 足のソケットは地面（足の裏）
    body.root.updateMatrixWorld(true);
    expect(body.sockets.foot_L.getWorldPosition(new Vector3()).y).toBeCloseTo(0, 6);
    // 武器のソケットの +Y（刃の向き）は、腕を下ろした姿勢で正面（+Z）
    const up = new Vector3(0, 1, 0).applyQuaternion(body.sockets.weapon_R.getWorldQuaternion(new Quaternion()));
    expect(up.z).toBeCloseTo(1, 6);
  });
});

describe('関節の回転の上限（A3 CP1 の提案値）', () => {
  it('9-5 の極端な姿勢（肘・膝 140°、肩 170°、股関節 90°の蹴り上げ、胴の 45°のひねり）が範囲内', () => {
    const inRange = (name: keyof typeof JOINT_LIMITS, axis: 'x' | 'y' | 'z', v: number) => {
      const a = JOINT_LIMITS[name][axis];
      return v >= a.min && v <= a.max;
    };
    expect(inRange('elbow_L', 'x', -140)).toBe(true);
    expect(inRange('elbow_R', 'x', -140)).toBe(true);
    expect(inRange('knee_L', 'x', 140)).toBe(true);
    expect(inRange('knee_R', 'x', 140)).toBe(true);
    expect(inRange('shoulder_L', 'z', 170)).toBe(true);
    expect(inRange('shoulder_R', 'z', -170)).toBe(true);
    expect(inRange('shoulder_L', 'x', -170)).toBe(true);
    expect(inRange('hip_L', 'x', -90)).toBe(true);
    expect(inRange('hip_R', 'x', -90)).toBe(true);
    expect(inRange('spine', 'y', 45)).toBe(true);
    expect(inRange('spine', 'y', -45)).toBe(true);
  });

  it('範囲外は上限に収める（肘は逆に曲がらない、膝は前に曲がらない）', () => {
    expect(clampJointRotation('elbow_L', { x: 30, y: 10, z: 10 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(clampJointRotation('knee_R', { x: -20, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(clampJointRotation('shoulder_L', { x: 0, y: 0, z: -90 }).z).toBe(-20);
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    expect(body.setJointRotationDeg('elbow_R', { x: -200, y: 0, z: 0 }).x).toBe(-145);
    expect(body.bones.elbow_R.rotation.x).toBeCloseTo((-145 * Math.PI) / 180, 9);
  });

  it('左右は鏡像（Y・Z の符号が逆）', () => {
    expect(JOINT_LIMITS.shoulder_R.z).toEqual({ min: -170, max: 20 });
    expect(JOINT_LIMITS.hip_R.z).toEqual({ min: -60, max: 15 });
    expect(JOINT_LIMITS.shoulder_R.x).toEqual(JOINT_LIMITS.shoulder_L.x);
  });
});
