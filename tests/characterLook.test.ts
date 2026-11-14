import { describe, expect, it } from 'vitest';
import { Box3, ShaderLib, Vector3 } from 'three';
import { CharacterBody, STANDING_POSE } from '../src/character/CharacterBody';
import { APPEARANCE_A, APPEARANCE_B, colorSlotOf } from '../src/character/appearance';
import { BODY_A, BODY_B, computeLayout } from '../src/character/bodyProfile';
import { createDummySword, SWORD } from '../src/character/dummySword';
import { applyInsertions } from '../src/render/internal/threeShaderPatch';
import { settingsForLevel } from '../src/platform/QualitySettings';
import type { JointName } from '../src/character/skeleton';

describe('体型B（A3 CP2）', () => {
  const k = 1.72 / 1.8;

  it('全高 1.72m（足の裏 0、頭の上端 1.72）', () => {
    const b = new CharacterBody(BODY_B, APPEARANCE_B);
    b.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(b.root);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.72, 3);
  });

  it('肩幅 ×0.88、腰の幅 ×1.04、手足の太さ ×0.93（体型A との比）', () => {
    expect(BODY_B.chest.w / BODY_A.chest.w).toBeCloseTo(0.88, 9);
    expect(BODY_B.chestBottomWidth / BODY_A.chestBottomWidth).toBeCloseTo(0.88, 9);
    expect(BODY_B.waist.w / BODY_A.waist.w).toBeCloseTo(1.04, 9);
    for (const part of ['upperArm', 'forearm', 'thigh', 'shin'] as const) {
      expect(BODY_B[part].w / BODY_A[part].w).toBeCloseTo(0.93, 9);
      expect(BODY_B[part].d / BODY_A[part].d).toBeCloseTo(0.93, 9);
    }
    // 肩の関節の間隔も ×0.88（胸の側面からの内側への寄せも同じ比）
    expect(computeLayout(BODY_B).shoulderX / computeLayout(BODY_A).shoulderX).toBeCloseTo(0.88, 9);
  });

  it('縦の長さは全高の比で縮む（股関節・肩の高さ、脚の比率は体型A と同じ）', () => {
    const a = computeLayout(BODY_A);
    const b = computeLayout(BODY_B);
    expect(b.hipJointY).toBeCloseTo(a.hipJointY * k, 9);
    expect(b.shoulderY).toBeCloseTo(a.shoulderY * k, 9);
    expect(b.hipJointY / BODY_B.height).toBeCloseTo(a.hipJointY / BODY_A.height, 9);
  });
});

describe('見た目（A3 CP2）', () => {
  it('部位はすべて色の割り当て先を持ち、頂点の色（色 × 陰影）が入る', () => {
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    for (const m of body.meshes) {
      expect(['skin', 'primary', 'secondary', 'accent', 'boots']).toContain(colorSlotOf(m.name));
      expect(m.geometry.getAttribute('color')).toBeTruthy();
    }
  });

  it('輪郭線：部位ごとに1つ。段階0〜6 は表示、段階7〜9 は非表示。影は落とさない', () => {
    const body = new CharacterBody(BODY_A, APPEARANCE_A);
    expect(body.outlines).toHaveLength(body.meshes.length);
    for (let lv = 0; lv <= 9; lv++) {
      body.applyQuality(settingsForLevel(lv));
      for (const o of body.outlines) {
        expect(o.visible).toBe(lv <= 6);
        expect(o.castShadow).toBe(false);
      }
    }
  });

  it('リムライト・輪郭線の差し込み先が three.js の実際のシェーダーにあり、差し込める', () => {
    const fs = ShaderLib.standard.fragmentShader;
    for (const s of ['#include <common>', '#include <lights_fragment_end>', 'vViewPosition', 'totalEmissiveRadiance']) expect(fs).toContain(s);
    // lights_fragment_end の後に、出力の計算で totalEmissiveRadiance が使われる（差し込んだ値が反映される）
    expect(fs.indexOf('totalEmissiveRadiance', fs.indexOf('#include <lights_fragment_end>'))).toBeGreaterThan(0);
    const vs = ShaderLib.basic.vertexShader;
    for (const s of ['#include <common>', '#include <begin_vertex>']) expect(vs).toContain(s);
    expect(() => applyInsertions(fs, [{ anchor: '#include <lights_fragment_end>', code: '// RIM' }], 'fragment')).not.toThrow();
    expect(() => applyInsertions(vs, [{ anchor: '#include <begin_vertex>', code: '// OUTLINE' }], 'vertex')).not.toThrow();
  });
});

describe('ダミーの剣（A3 CP2）', () => {
  it('剣は weapon_base（刃の根元）・weapon_tip（先端）のソケットを持つ', () => {
    const s = createDummySword();
    expect(s.sockets.weapon_base.parent).toBe(s.root);
    expect(s.sockets.weapon_tip.parent).toBe(s.root);
    expect(s.sockets.weapon_tip.position.y - s.sockets.weapon_base.position.y).toBeCloseTo(SWORD.bladeTip - SWORD.bladeBase, 9);
    s.mesh.geometry.computeBoundingBox();
    expect(s.mesh.geometry.boundingBox!.max.y).toBeCloseTo(SWORD.bladeTip, 3);
  });

  it('体型B の weapon_R に付けると、刃は拳から体の正面へ向く（先端 → 根元 → 拳の順に前）', () => {
    const b = new CharacterBody(BODY_B, APPEARANCE_B);
    b.applyPoseDeg(STANDING_POSE);
    const sword = createDummySword();
    b.attach('weapon_R', sword.root);
    expect(sword.root.parent).toBe(b.sockets.weapon_R);
    b.root.updateMatrixWorld(true);
    const hand = b.sockets.hand_R.getWorldPosition(new Vector3());
    const base = sword.sockets.weapon_base.getWorldPosition(new Vector3());
    const tip = sword.sockets.weapon_tip.getWorldPosition(new Vector3());
    // 体の正面は +Z（root を回していないので）
    expect(base.z).toBeGreaterThan(hand.z);
    expect(tip.z).toBeGreaterThan(base.z + 0.6);
    expect(tip.distanceTo(base)).toBeCloseTo(SWORD.bladeTip - SWORD.bladeBase, 6);
    // 握りの中心は拳の中心（右手の側）
    expect(sword.root.getWorldPosition(new Vector3()).distanceTo(hand)).toBeLessThan(1e-6);
    expect(hand.x).toBeLessThan(0);
  });
});

describe('確認用（開発・検証専用。A3 CP3）', async () => {
  const { EXTREME_POSE, setSilhouette } = await import('../src/debug/characterChecks');
  const { clampJointRotation } = await import('../src/character/jointLimits');

  it('極端な姿勢は 9-5 の角度（肘・膝 140°、肩 170°、股関節 90°、胴 45°）で、回転の上限に収まる（切り詰められない）', () => {
    expect(EXTREME_POSE.elbow_R!.x).toBe(-140);
    expect(EXTREME_POSE.knee_R!.x).toBe(140);
    expect(EXTREME_POSE.shoulder_L!.z).toBe(170);
    expect(EXTREME_POSE.hip_L!.x).toBe(-90);
    expect(EXTREME_POSE.spine!.y).toBe(45);
    for (const [name, deg] of Object.entries(EXTREME_POSE)) {
      expect(clampJointRotation(name as JointName, deg!)).toEqual(deg);
    }
  });

  it('シルエット：体を黒一色にして輪郭線を消し、元に戻せる', () => {
    const body = new CharacterBody(BODY_B, APPEARANCE_B);
    const before = body.meshes.map((m) => m.material);
    setSilhouette(body, true);
    expect(new Set(body.meshes.map((m) => m.material)).size).toBe(1);
    expect(body.outlines.every((o) => !o.visible)).toBe(true);
    setSilhouette(body, false);
    expect(body.meshes.map((m) => m.material)).toEqual(before);
  });
});
