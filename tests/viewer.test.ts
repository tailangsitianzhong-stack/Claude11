import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  PAIR_HALF_SPACING,
  VIEWER_VIEWS,
  cameraPosition,
  characterPositions,
  framing,
  viewDistance,
} from '../src/viewer/viewerLayout';

describe('ビューアーの配置とカメラ（A4 CP1）', () => {
  it('キャラクターの選択：1体は中央、2体は左右に並べる（A が左 -X、B が右 +X）', () => {
    expect(characterPositions('A')).toEqual({ A: 0, B: null });
    expect(characterPositions('B')).toEqual({ A: null, B: 0 });
    expect(characterPositions('AB')).toEqual({ A: -PAIR_HALF_SPACING, B: PAIR_HALF_SPACING });
  });

  it('表示範囲：全高 1.80m の体（2体なら左右の間隔と肩幅も）が球に収まる', () => {
    const one = framing('A');
    expect(Math.hypot(0.5, 1.8 - one.center.y)).toBeLessThanOrEqual(one.radius);
    expect(Math.hypot(0.5, 0 - one.center.y)).toBeLessThanOrEqual(one.radius);
    const two = framing('AB');
    expect(Math.hypot(PAIR_HALF_SPACING + 0.4, 1.8 - two.center.y)).toBeLessThanOrEqual(two.radius);
  });

  it('4つの視点：正面は +Z、側面は +X、斜めは +X+Z の上、上からは真上。どれも注視点から同じ距離', () => {
    const c = new Vector3(0, 0.9, 0);
    const d = 4;
    const p = Object.fromEntries(VIEWER_VIEWS.map((v) => [v, cameraPosition(v, c, d).sub(c)]));
    expect(p.front!.z).toBeGreaterThan(3.9);
    expect(Math.abs(p.front!.x)).toBeLessThan(1e-9);
    expect(p.side!.x).toBeGreaterThan(3.9);
    expect(Math.abs(p.side!.z)).toBeLessThan(1e-9);
    expect(p.oblique!.x).toBeGreaterThan(0);
    expect(p.oblique!.z).toBeGreaterThan(0);
    expect(p.oblique!.y).toBeGreaterThan(0);
    expect(p.top!.y).toBeGreaterThan(3.99);
    for (const v of VIEWER_VIEWS) expect(p[v]!.length()).toBeCloseTo(d, 9);
  });

  it('縦長の画面では距離が長くなり、球が横幅にも収まる', () => {
    expect(viewDistance(1, 45, 390 / 844)).toBeGreaterThan(viewDistance(1, 45, 16 / 9));
  });
});
