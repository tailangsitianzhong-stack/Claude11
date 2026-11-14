import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { BUILT_OVERVIEW, COLOSSEUM, MAX_FLOOR_RINGS, generateFloorRings, pillarPositions } from '../src/stage/stages/colosseum/layout';
import { PILLAR_PARTS, buildPillars, createPillarStoneGeometry } from '../src/stage/stages/colosseum/buildPillars';
import { buildRim } from '../src/stage/stages/colosseum/buildRim';
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

describe('外周と柱（A2-2）', () => {
  const C = COLOSSEUM;

  it('柱は12本、半径18の円周上に正確に等間隔（30°おき）、正面（+Z）の真ん中には立たない', () => {
    const p = pillarPositions();
    expect(p).toHaveLength(12);
    const angles = p.map(([x, z]) => {
      expect(Math.hypot(x, z)).toBeCloseTo(18, 9);
      return (Math.atan2(x, z) * 180) / Math.PI;
    });
    for (let i = 1; i < angles.length; i++) {
      expect((((angles[i]! - angles[i - 1]!) % 360) + 360) % 360).toBeCloseTo(30, 9);
    }
    for (const a of angles) expect(Math.abs(a)).toBeGreaterThan(1);
  });

  it('柱の高さは 7.5m、柱身の直径は 1.1m', () => {
    const geo = createPillarStoneGeometry();
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(geo.boundingBox!.max.y).toBeCloseTo(C.pillarHeight, 6);
    // 柱身（礎盤の上〜柱頭の下）は1段の円柱：その範囲の頂点は上下の端だけで、中心から 0.55m
    const shaftBottom = PILLAR_PARTS.plinth.height + PILLAR_PARTS.base.height;
    const shaftTop = C.pillarHeight - PILLAR_PARTS.abacus.height - PILLAR_PARTS.capital.height;
    const pos = geo.getAttribute('position');
    let shaftR = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      expect(y > shaftBottom + 1e-4 && y < shaftTop - 1e-4).toBe(false);
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if ((Math.abs(y - shaftTop) < 1e-4 || Math.abs(y - shaftBottom) < 1e-4) && r > 0.5 && r < 0.6) {
        shaftR = Math.max(shaftR, r);
      }
    }
    expect(shaftR * 2).toBeCloseTo(C.pillarDiameter, 5);
  });

  it('柱は InstancedMesh（石・ブロンズの2つ、各12個）で、段差の上に立つ', () => {
    const { stone, bands } = buildPillars();
    for (const m of [stone, bands]) {
      expect(m.isInstancedMesh).toBe(true);
      expect(m.count).toBe(12);
    }
    const box = new Box3().setFromObject(stone);
    expect(box.min.y).toBeCloseTo(-C.terraceDrop, 6);
    expect(box.max.y).toBeCloseTo(-C.terraceDrop + C.pillarHeight, 6);
    // 台石の角まで段差の上に収まる
    expect(Math.max(box.max.x, box.max.z, -box.min.x, -box.min.z)).toBeLessThan(C.terraceOuterRadius);
  });

  it('低い壁は戦闘の境界の外側（キャラクターの当たり判定の半径0.35を考慮）、柱は台座の外側', () => {
    expect(C.rimWallInnerRadius).toBeGreaterThan(C.boundaryRadius + 0.35);
    expect(C.rimWallInnerRadius).toBeLessThan(C.arenaRadius);
    const plinthHalf = PILLAR_PARTS.plinth.width / 2;
    expect(C.pillarRingRadius - Math.SQRT2 * PILLAR_PARTS.abacus.width / 2).toBeGreaterThan(C.arenaRadius);
    expect(C.pillarRingRadius - plinthHalf).toBeGreaterThan(C.arenaRadius);
  });

  it('外周の壁（高さ0.6）・段差（半径20）の寸法', () => {
    const { wall, cap, terrace } = buildRim();
    const w = new Box3().setFromObject(wall).union(new Box3().setFromObject(cap));
    expect(w.max.y).toBeCloseTo(C.rimWallHeight, 6);
    expect(w.min.y).toBeCloseTo(0, 6);
    const t = new Box3().setFromObject(terrace);
    expect(t.max.y).toBeCloseTo(-C.terraceDrop, 6);
    expect(t.min.y).toBeCloseTo(-C.platformHeight, 6);
    expect(t.max.x).toBeGreaterThanOrEqual(C.terraceOuterRadius);
  });

  it('全景の球は、作った部分（段差の外周・柱の頂上）をすべて包む', () => {
    const center = new Vector3(0, BUILT_OVERVIEW.centerY, 0);
    const { stone } = buildPillars();
    const { terrace, wall } = buildRim();
    for (const obj of [stone, terrace, wall]) {
      const b = new Box3().setFromObject(obj);
      // 円形の物の箱の角は実際より遠いので、上から見た半径は物ごとの最大値で調べる
      const r = Math.max(b.max.x, b.max.z, -b.min.x, -b.min.z);
      for (const y of [b.min.y, b.max.y]) {
        expect(Math.hypot(r, y - center.y)).toBeLessThanOrEqual(BUILT_OVERVIEW.radius + 1e-9);
      }
    }
  });
});

describe('観客席・外壁（A2-3 CP1）', async () => {
  const { STANDS_ROW_DEPTH, STANDS_TOP_Y, archBayAngleDeg } = await import('../src/stage/stages/colosseum/layout');
  const { buildStands, standsProfile } = await import('../src/stage/stages/colosseum/buildStands');
  const { buildOuterWall } = await import('../src/stage/stages/colosseum/buildOuterWall');
  const C = COLOSSEUM;

  it('観客席は半径24〜36（14段、1段の奥行き約0.81m・高さ0.33m）、最上段の奥は外壁の内側の面まで', () => {
    const prof = standsProfile();
    const rs = prof.map(([r]) => r);
    expect(Math.min(...rs)).toBeCloseTo(C.standsInnerRadius, 9);
    expect(Math.max(...rs)).toBeCloseTo(C.outerWallInnerRadius, 9);
    // 最上段の段の奥は standsOuterRadius
    expect(C.standsInnerRadius + C.standsPodiumLedge + STANDS_ROW_DEPTH * C.standsRowCount).toBeCloseTo(C.standsOuterRadius, 9);
    expect(STANDS_ROW_DEPTH).toBeGreaterThan(0.75);
    expect(STANDS_ROW_DEPTH).toBeLessThan(0.9);
    expect(STANDS_TOP_Y).toBeCloseTo(6.62, 9);
    // 観客席は柱・かがり火の段差（半径20）の外
    expect(C.standsInnerRadius).toBeGreaterThan(C.terraceOuterRadius);
  });

  it('外壁は半径37〜38・高さ12。アーチの回廊は頂点の上に上端まで 1m 以上、開口の高さは 4m 以上', () => {
    const wall = buildOuterWall();
    expect(wall.isInstancedMesh).toBe(true);
    expect(wall.count).toBe(36);
    const b = new Box3().setFromObject(wall);
    expect(b.max.y).toBeCloseTo(C.outerWallHeight, 6);
    expect(b.min.y).toBeCloseTo(-C.platformHeight, 6);
    expect(Math.max(b.max.x, b.max.z, -b.min.x, -b.min.z)).toBeLessThanOrEqual(C.outerWallRadius + 0.13); // 蛇腹の張り出しを含む
    const apex = STANDS_TOP_Y + C.arcadeSpringHeight + C.arcadeOpeningWidth / 2;
    expect(apex - STANDS_TOP_Y).toBeGreaterThanOrEqual(4);
    expect(C.outerWallHeight - apex).toBeGreaterThanOrEqual(1);
  });

  it('アーチの区画は36（10°ごと）、正面（+Z）の真ん中がアーチ', () => {
    expect(archBayAngleDeg(0)).toBe(0);
    expect(archBayAngleDeg(1)).toBe(10);
    expect(C.archBayCount).toBe(36);
  });

  it('全景の基準は中心の高さ4・半径40で、観客席・外壁を包む', () => {
    expect(BUILT_OVERVIEW.centerY).toBe(4);
    expect(BUILT_OVERVIEW.radius).toBe(40);
    for (const obj of [buildStands(), buildOuterWall()]) {
      const b = new Box3().setFromObject(obj);
      const r = Math.max(b.max.x, b.max.z, -b.min.x, -b.min.z);
      for (const y of [b.min.y, b.max.y]) expect(Math.hypot(r, y - BUILT_OVERVIEW.centerY)).toBeLessThanOrEqual(BUILT_OVERVIEW.radius);
    }
  });
});
