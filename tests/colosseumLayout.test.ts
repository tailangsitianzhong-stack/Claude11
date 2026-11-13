import { describe, expect, it } from 'vitest';
import { COLOSSEUM, MAX_FLOOR_RINGS, generateFloorRings } from '../src/stage/stages/colosseum/layout';
import { SCALE_REFERENCE_POSITIONS } from '../src/debug/ScaleReference';

describe('Dusk Colosseum の寸法', () => {
  it('設計どおりの寸法と大小関係', () => {
    const C = COLOSSEUM;
    expect(C.arenaRadius).toBe(16);
    expect(C.boundaryRadius).toBe(15);
    expect(C.pillarRingRadius).toBe(18);
    expect(C.pillarCount).toBe(12);
    expect(C.standsInnerRadius).toBe(24);
    expect(C.boundaryRadius).toBeLessThan(C.arenaRadius);
    // 柱は台座の外側（柱の半径ぶん離れている）
    expect(C.pillarRingRadius - C.pillarDiameter / 2).toBeGreaterThan(C.arenaRadius);
    // 観客席は柱の外側
    expect(C.standsInnerRadius).toBeGreaterThan(C.pillarRingRadius + C.pillarDiameter / 2);
    expect(C.outerWallRadius).toBeGreaterThan(C.standsOuterRadius);
    // 全景の球は外壁を含む
    expect(C.fullOverviewRadius).toBeGreaterThanOrEqual(C.outerWallRadius);
  });

  it('大きさの目安は境界の内側（当たり判定の半径0.35を考慮）', () => {
    for (const [x, , z] of SCALE_REFERENCE_POSITIONS) {
      expect(Math.hypot(x, z) + 0.35).toBeLessThanOrEqual(COLOSSEUM.boundaryRadius);
    }
  });
});

describe('床の石畳の環', () => {
  const rings = generateFloorRings();

  it('決定的に生成される（毎回同じ見た目）', () => {
    expect(generateFloorRings()).toEqual(rings);
    expect(generateFloorRings(1)).not.toEqual(rings);
  });

  it('シェーダーの上限を超えない', () => {
    expect(rings.length).toBeLessThanOrEqual(MAX_FLOOR_RINGS);
  });

  it('紋章の外側から台座の端まで、象嵌の帯を除いて隙間なく並ぶ', () => {
    const C = COLOSSEUM;
    expect(rings[0]!.inner).toBeCloseTo(C.emblemRadius, 9);
    expect(rings[rings.length - 1]!.outer).toBeCloseTo(C.arenaRadius, 9);
    for (let i = 1; i < rings.length; i++) {
      const gap = rings[i]!.inner - rings[i - 1]!.outer;
      if (rings[i]!.type === 2) expect(gap).toBeCloseTo(C.boundaryInlayWidth, 9); // 象嵌の帯
      else expect(gap).toBeCloseTo(0, 9);
    }
  });

  it('半径10に目安の帯、境界の外に縁石の環がある', () => {
    const accent = rings.filter((r) => r.type === 1);
    expect(accent).toHaveLength(1);
    expect((accent[0]!.inner + accent[0]!.outer) / 2).toBeCloseTo(COLOSSEUM.accentRingRadius, 9);
    expect(rings[rings.length - 1]!.type).toBe(2);
  });

  it('石の大きさが均一にならない（環の幅・石の長さがばらつく）', () => {
    const field = rings.filter((r) => r.type === 0);
    const widths = field.map((r) => r.outer - r.inner);
    const lengths = field.map((r) => (2 * Math.PI * ((r.inner + r.outer) / 2)) / r.count);
    for (const w of widths) expect(w).toBeGreaterThan(0.6), expect(w).toBeLessThan(1.4);
    for (const l of lengths) expect(l).toBeGreaterThan(0.85), expect(l).toBeLessThan(1.6);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(0.1);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.1);
  });

  it('石の長さのゆらぎで並びが逆転しない（単調）・円周で継ぎ目が出ない（整数の周波数）', () => {
    for (const r of rings) {
      expect(Number.isInteger(r.count)).toBe(true);
      expect(Number.isInteger(r.warpK)).toBe(true);
      // ゆらぎの微分の最大値 < 1
      expect((r.warpAmp * 2 * Math.PI * r.warpK) / r.count).toBeLessThan(1);
    }
  });
});
