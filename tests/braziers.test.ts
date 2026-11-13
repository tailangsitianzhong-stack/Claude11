import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { COLOSSEUM, brazierPositions, pillarPositions } from '../src/stage/stages/colosseum/layout';
import { PILLAR_PARTS } from '../src/stage/stages/colosseum/buildPillars';
import {
  BRAZIER_PARTS,
  Braziers,
  createBrazierBowlGeometry,
  createBrazierStandGeometry,
  createFlameGeometry,
  FLAME_TOP_FADE,
  fireDetailFor,
} from '../src/stage/stages/colosseum/braziers';
import { PRESET_LEVELS, settingsForLevel } from '../src/platform/QualitySettings';

const deg = ([x, z]: [number, number]) => ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360;

describe('かがり火（A2-2）', () => {
  it('6基、柱と同じ半径18、60°おき', () => {
    const b = brazierPositions();
    expect(b).toHaveLength(6);
    for (const p of b) expect(Math.hypot(p[0], p[1])).toBeCloseTo(COLOSSEUM.pillarRingRadius, 9);
    const a = b.map(deg);
    for (let i = 1; i < a.length; i++) expect(a[i]! - a[i - 1]!).toBeCloseTo(60, 9);
  });

  it('隣り合う柱のちょうど中間（柱から15°）に、柱の間1つおきに置く', () => {
    const pillars = pillarPositions().map(deg);
    const gaps = new Set<number>();
    for (const a of brazierPositions().map(deg)) {
      const diffs = pillars.map((p) => Math.abs(((a - p + 540) % 360) - 180));
      const sorted = [...diffs].sort((x, y) => x - y);
      expect(sorted[0]).toBeCloseTo(15, 9); // 最も近い柱が両側に15°ずつ
      expect(sorted[1]).toBeCloseTo(15, 9);
      gaps.add(Math.round(((a - 15 - COLOSSEUM.pillarAngleOffsetDeg + 360) % 360) / 30));
    }
    // 12の間のうち、1つおきの6つ（すべて偶数番目）
    expect([...gaps].every((g) => g % 2 === 0)).toBe(true);
    expect(gaps.size).toBe(6);
  });

  it('柱・壁と重ならず、段差の上に収まる', () => {
    const pillarHalf = (Math.SQRT2 * Math.max(PILLAR_PARTS.plinth.width, PILLAR_PARTS.abacus.width)) / 2;
    const brazierHalf = Math.max((Math.SQRT2 * BRAZIER_PARTS.plinth.width) / 2, BRAZIER_PARTS.bowl.rimDiameter / 2);
    for (const [bx, bz] of brazierPositions()) {
      for (const [px, pz] of pillarPositions()) {
        expect(Math.hypot(bx - px, bz - pz)).toBeGreaterThan(pillarHalf + brazierHalf + 2);
      }
      const r = Math.hypot(bx, bz);
      expect(r - brazierHalf).toBeGreaterThan(COLOSSEUM.arenaRadius); // 壁・台座の外
      expect(r + BRAZIER_PARTS.pool.diameter / 2).toBeLessThanOrEqual(COLOSSEUM.terraceOuterRadius); // 光だまりも段差の上
    }
  });

  it('台と火皿の寸法（火皿の上端 1.30m、炭は火皿の中）', () => {
    const stand = createBrazierStandGeometry();
    stand.computeBoundingBox();
    expect(stand.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(stand.boundingBox!.max.y).toBeCloseTo(0.98, 6);
    const bowl = createBrazierBowlGeometry();
    bowl.computeBoundingBox();
    expect(bowl.boundingBox!.min.y).toBeCloseTo(0.98, 6);
    expect(bowl.boundingBox!.max.y).toBeCloseTo(1.3, 6);
    expect(bowl.boundingBox!.max.x).toBeCloseTo(BRAZIER_PARTS.bowl.rimDiameter / 2, 3);
    expect(BRAZIER_PARTS.coal.y).toBeGreaterThan(0.98);
    expect(BRAZIER_PARTS.coal.y).toBeLessThan(1.3);
  });

  it('6基まとめて描く（InstancedMesh 4つ。点光源なし）、段差の上に立つ', () => {
    const b = new Braziers();
    expect(b.meshes).toHaveLength(4);
    for (const m of b.meshes) {
      expect(m.isInstancedMesh).toBe(true);
      expect(m.count).toBe(6);
    }
    const box = new Box3().setFromObject(b.stand);
    expect(box.min.y).toBeCloseTo(-COLOSSEUM.terraceDrop, 6);
    // 炎・光は影を落とさない
    expect(b.flames.castShadow).toBe(false);
    expect(b.glow.castShadow).toBe(false);
  });

  it('画質のプリセットごとの演出：高=high、中=medium、低=low', () => {
    expect(fireDetailFor(settingsForLevel(PRESET_LEVELS.high))).toBe('high');
    expect(fireDetailFor(settingsForLevel(PRESET_LEVELS.medium))).toBe('medium');
    expect(fireDetailFor(settingsForLevel(PRESET_LEVELS.low))).toBe('low');
  });

  it('低画質では足元の光だまりを省き（炭だけ）、戻すと全部描く', () => {
    const b = new Braziers();
    b.applyDetail('low');
    expect(b.glow.geometry.drawRange.count).toBe(32 * 3);
    b.applyDetail('high');
    expect(b.glow.geometry.drawRange.count).toBe(Infinity);
  });

  it('揺らぎの時間は進み、長時間でも大きくなり続けない', () => {
    const b = new Braziers();
    b.update(1 / 60);
    expect(b.timeValue).toBeCloseTo(1 / 60, 9);
    for (let i = 0; i < 4000; i++) b.update(1);
    expect(b.timeValue).toBeLessThan(3600);
  });

  it('炎：縦の2層（外側・芯）と、真上から見たとき用の水平の板（火皿の口の内側に収まる）', () => {
    const geo = createFlameGeometry();
    const layer = geo.getAttribute('aLayer');
    const pos = geo.getAttribute('position');
    const F = BRAZIER_PARTS.flame;
    const counts = [0, 0, 0];
    for (let i = 0; i < layer.count; i++) {
      const l = layer.getX(i);
      counts[l]!++;
      if (l === 2) {
        expect(pos.getY(i)).toBeCloseTo(F.topY, 6); // 水平
        expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(F.topDiameter / 2 + 1e-6);
      }
    }
    expect(counts).toEqual([4, 4, 4]);
    // 水平の板は火皿の口（上端 1.30）より上、口の直径より小さい
    expect(F.base + F.topY).toBeGreaterThan(BRAZIER_PARTS.coal.y);
    expect(F.topDiameter).toBeLessThan(BRAZIER_PARTS.bowl.rimDiameter);
  });

  it('水平の炎は、正面（15°）・斜めの視点では現れず、真上に近いほど現れる', () => {
    const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);
    expect(sin(15)).toBeLessThan(FLAME_TOP_FADE.start);
    expect(sin(32)).toBeLessThan(FLAME_TOP_FADE.start); // 斜めの全景（中心から約31°見下ろし）
    expect(sin(90)).toBeGreaterThan(FLAME_TOP_FADE.end);
    expect(FLAME_TOP_FADE.end - FLAME_TOP_FADE.start).toBeGreaterThanOrEqual(0.25); // なめらかに切り替える幅
  });
});
